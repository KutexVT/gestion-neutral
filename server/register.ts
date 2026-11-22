import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { amount, audit, changed, config, digest, need, pool, transaction, uuid, type Actor, type DB } from "./db.js";
import { cashGroups } from "../web/cash-count.js";

// All account and register mutations share this lock. A review never cuts through a collection.
export const lockRegister = (db: DB) => db.query("SELECT pg_advisory_xact_lock(734832)");
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).refine(v => z.iso.datetime().safeParse(v.length === 16 ? `${v}:00Z` : `${v}Z`).success);
const timestamp = z.union([z.iso.datetime({ offset: true }), localDate]);
const periodSchema = z.object({ from: timestamp, to: timestamp.optional() }).strict();
const methodSchema = z.enum(["cash", "sinpe", "card"]);
const reasonSchema = z.string().trim().min(3).max(500);
const owner = (request: FastifyRequest) => need(request.actor?.role === "admin", 403, "Solo el dueño puede gestionar cierres de caja");
const closer = (actor: Actor) => need(actor.role === "admin" || actor.can_close_register,403,"No tienes permiso para hacer cierres de caja");
// The full snapshot is preserved for the owner. Staff only receive the reconciliation data.
function visibleSnapshot(data: any, actor: Actor) {
  if (actor.role === "admin") return data;
  const {cost,profit,missing_cost_units,personal,personal_total,events,more_events,...rest} = data;
  return {...rest,events:[],more_events:false,personal:[],sales:data.sales.map((s:any) => {
    const {cost,profit,missing_cost_units,...sale} = s; return sale;
  })};
}
function visibleClosing(row: any, actor: Actor) {
  const electronic = row.snapshot.collected.sinpe+row.snapshot.movements.sinpe+row.snapshot.collected.card+row.snapshot.movements.card;
  return {...row,total:safe(row.actual_cash+electronic),charged_total:safe(row.expected_cash+electronic),snapshot:visibleSnapshot(row.snapshot,actor)};
}
const safe = (n: number) => { need(Number.isSafeInteger(n), 400, "Reduce el intervalo: el importe excede el límite permitido"); return n; };
async function instant(db: DB, value: string) {
  return (await db.query(`SELECT ${/Z$|[+-]\d\d:\d\d$/.test(value) ? "$1::timestamptz" : "$1::timestamp AT TIME ZONE $2"} AS value`,
    /Z$|[+-]\d\d:\d\d$/.test(value) ? [value] : [value, config.timezone])).rows[0].value as Date;
}
async function period(db: DB, input: unknown) {
  const body = periodSchema.parse(input);
  const from = await instant(db, body.from);
  const now = (await db.query("SELECT clock_timestamp() AS now")).rows[0].now as Date;
  const to = body.to ? await instant(db, body.to) : now;
  need(from < to && to <= now && to.getTime()-from.getTime() <= 31*86400000, 400,
    "Usa un intervalo pasado de hasta 31 días con la hora final posterior a la inicial");
  return { from: from.toISOString(), to: to.toISOString() };
}

async function snapshot(db: DB, input: unknown) {
  const range = await period(db, input);
  const { rows: sales } = await db.query(`SELECT a.id,a.name,a.currency,a.version,a.arrived_at,a.closed_at,a.paid_at,
    a.calculated_total,a.final_total,a.payment_cash,a.payment_sinpe,a.payment_card,
    a.cash_received,a.cash_change,u.name AS seller_name,u.id AS seller_id,
    costs.missing_cost_units,CASE WHEN costs.missing_cost_units=0 THEN costs.cost END AS cost,
    CASE WHEN costs.missing_cost_units=0 THEN a.final_total-costs.cost END AS profit,
    (SELECT id FROM invoices WHERE account_id=a.id ORDER BY revision DESC LIMIT 1) AS invoice_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('product',c.product_name,'quantity',c.quantity,
      'unit_price',c.unit_price,'waiter',w.name) ORDER BY c.recorded_at,c.id)
      FROM consumption c JOIN users w ON w.id=c.recorded_by WHERE c.account_id=a.id AND c.quantity>0),'[]') AS items
    FROM accounts a JOIN users u ON u.id=a.closed_by
    LEFT JOIN LATERAL (SELECT COALESCE(sum(quantity::bigint*unit_cost),0)::bigint AS cost,
      COALESCE(sum(quantity) FILTER (WHERE unit_cost IS NULL),0)::bigint AS missing_cost_units
      FROM consumption WHERE account_id=a.id AND quantity>0) costs ON true
    WHERE a.kind='customer' AND a.paid_at >= $1 AND a.paid_at < $2
    ORDER BY a.paid_at,a.id LIMIT 2001`, [range.from, range.to]);
  need(sales.length <= 2000, 400, "Hay más de 2000 ventas. Reduce el intervalo del cierre");
  need(sales.every(s => s.currency === config.currency), 400, "El intervalo contiene ventas en otra moneda. Revisa el periodo");
  const { rows: entries } = await db.query(`SELECT e.*,u.name AS actor_name FROM cash_entries e JOIN users u ON u.id=e.actor_id
    WHERE e.occurred_at >= $1 AND e.occurred_at < $2 ORDER BY e.occurred_at,e.id LIMIT 2001`, [range.from, range.to]);
  need(entries.length <= 2000, 400, "Hay demasiados movimientos. Reduce el intervalo");
  need(entries.every(e => e.currency === config.currency), 400, "El intervalo contiene movimientos en otra moneda");
  const { rows: pending } = await db.query(`SELECT a.id,a.name,a.calculated_total,a.currency,u.name AS seller_name
    FROM accounts a JOIN users u ON u.id=a.created_by WHERE a.kind='customer' AND a.arrived_at < $1
      AND (a.paid_at IS NULL OR a.paid_at >= $1) ORDER BY a.arrived_at,a.id LIMIT 2001`, [range.to]);
  need(pending.length <= 2000, 400, "Hay demasiadas cuentas pendientes para este resumen");
  const { rows: events } = await db.query(`SELECT a.id,a.created_at,a.action,a.entity_id,a.before_value,a.after_value,u.name AS actor_name
    FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.created_at >= $1 AND a.created_at < $2
    ORDER BY a.created_at DESC,a.id DESC LIMIT 501`, [range.from, range.to]);
  const { rows: personalEvents } = await db.query(`SELECT a.id,a.entity_id AS account_id,a.created_at,a.before_value,a.after_value,
    u.name AS person_name,u.role AS person_role,x.name AS actor_name
    FROM audit a JOIN accounts p ON p.id=a.entity_id JOIN users u ON u.id=p.created_by JOIN users x ON x.id=a.actor_id
    WHERE a.action='Consumo personal corregido' AND p.kind='personal'
      AND a.created_at >= $1 AND a.created_at < $2 ORDER BY a.created_at,a.id LIMIT 2001`, [range.from,range.to]);
  need(personalEvents.length <= 2000, 400, "Hay demasiados movimientos de consumo personal. Reduce el intervalo");
  const personal = personalEvents.map(e => {
    need(e.after_value.currency === config.currency, 400, "El intervalo contiene consumo personal en otra moneda");
    type Item = { id: string; product_name: string; quantity: number; unit_price: number };
    const before = new Map<string,Item>((e.before_value.items as Item[]).map(item => [item.id,item]));
    const after = new Map<string,Item>((e.after_value.items as Item[]).map(item => [item.id,item]));
    const items = [...new Set([...before.keys(),...after.keys()])].map(id => {
      const item = after.get(id) ?? before.get(id)!;
      return { product: item.product_name, unit_price: item.unit_price,
        quantity: (after.get(id)?.quantity ?? 0)-(before.get(id)?.quantity ?? 0) };
    }).filter(item => item.quantity !== 0);
    return { id:e.id, account_id:e.account_id, created_at:e.created_at, person_name:e.person_name,
      person_role:e.person_role, actor_name:e.actor_name, items,
      total:items.reduce((sum,item) => safe(sum+item.quantity*item.unit_price),0) };
  }).filter(e => e.items.length > 0);
  const personal_total = personal.reduce((sum,e) => safe(sum+e.total),0);
  const collected = { cash: 0, sinpe: 0, card: 0 };
  const movements = { cash: 0, sinpe: 0, card: 0 };
  const sellers: Record<string, { name: string; accounts: number; sales: number; cash: number; sinpe: number; card: number }> = {};
  let total = 0, calculated = 0, unclassified = 0, cost = 0, missing_cost_units = 0;
  for (const s of sales) {
    total = safe(total+s.final_total); calculated = safe(calculated+s.calculated_total);
    cost = safe(cost+(s.cost ?? 0)); missing_cost_units = safe(missing_cost_units+s.missing_cost_units);
    if (s.payment_cash === null) unclassified++;
    const seller = sellers[s.seller_id] ??= { name: s.seller_name, accounts: 0, sales: 0, cash: 0, sinpe: 0, card: 0 };
    seller.accounts++; seller.sales = safe(seller.sales+s.final_total);
    for (const method of ["cash", "sinpe", "card"] as const) {
      const value = s[`payment_${method}`] ?? 0;
      collected[method] = safe(collected[method]+value);
      seller[method] = safe(seller[method]+value);
    }
  }
  for (const e of entries) {
    const method = e.method as keyof typeof movements;
    movements[method] = safe(movements[method]+(e.direction === "in" ? e.amount : -e.amount));
  }
  for (const method of ["cash", "sinpe", "card"] as const) safe(collected[method]+movements[method]);
  return { period: range, currency: config.currency, timezone: config.timezone, sales, entries, pending,
    events: events.slice(0, 500), more_events: events.length > 500, sellers: Object.values(sellers),
    total, calculated, collected, movements, unclassified, personal, personal_total,
    cost: missing_cost_units ? null : cost, profit: missing_cost_units ? null : safe(total-cost), missing_cost_units };
}

export function registerCash(app: FastifyInstance,
  write: (request: FastifyRequest, fn: (db: pg.PoolClient, actor: Actor) => Promise<unknown>) => Promise<unknown>) {
  app.get("/api/register/settings", async request => {
    closer(request.actor!);
    const { rows: [s] } = await pool.query(`SELECT to_char(day_start,'HH24:MI') AS day_start,opening_default,
      to_char((clock_timestamp() AT TIME ZONE $1 - day_start)::date + day_start,'YYYY-MM-DD"T"HH24:MI') AS period_from
      FROM register_settings`, [config.timezone]);
    return s;
  });
  app.put("/api/register/settings", request => {
    owner(request);
    return write(request, async (db, actor) => {
      const body = z.object({ day_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), opening_default: amount.nullable() }).strict().parse(request.body);
      const before = (await db.query("SELECT * FROM register_settings FOR UPDATE")).rows[0];
      await db.query("UPDATE register_settings SET day_start=$1,opening_default=$2", [body.day_start, body.opening_default]);
      await audit(db, actor.id, "Configuración de caja cambiada", null, before, body);
      await changed(db, "admins");
      return body;
    });
  });
  app.post("/api/register/preview", async request => {
    closer(request.actor!);
    return transaction(async db => {
      await lockRegister(db);
      const data = await snapshot(db, request.body);
      return { ...visibleSnapshot(data,request.actor!), fingerprint: digest(JSON.stringify(data)) };
    });
  });
  app.post("/api/register/entries", request => {
    owner(request);
    return write(request, async (db, actor) => {
      const b = z.object({ method: methodSchema, direction: z.enum(["in", "out"]), amount: amount.refine(n => n > 0),
        occurred_at: timestamp, reason: reasonSchema }).strict().parse(request.body);
      const at = await instant(db, b.occurred_at);
      need(at <= new Date(), 400, "El movimiento no puede tener una fecha futura");
      const entry = (await db.query(`INSERT INTO cash_entries(actor_id,method,direction,amount,occurred_at,reason,currency)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [actor.id,b.method,b.direction,b.amount,at,b.reason,config.currency])).rows[0];
      await audit(db, actor.id, "Movimiento de caja registrado", entry.id, null, entry);
      await changed(db, "admins");
      return entry;
    });
  });
  app.post("/api/register/entries/:id/reverse", request => {
    owner(request);
    return write(request, async (db, actor) => {
      const { reason } = z.object({ reason: reasonSchema }).strict().parse(request.body);
      const id = uuid.parse((request.params as {id: string}).id);
      const previous = (await db.query("SELECT * FROM cash_entries WHERE id=$1", [id])).rows[0];
      need(previous && !previous.reverses, 400, "No se puede anular este movimiento");
      const entry = (await db.query(`INSERT INTO cash_entries(actor_id,method,direction,amount,occurred_at,reason,currency,reverses)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [actor.id,previous.method,previous.direction === "in" ? "out" : "in",
        previous.amount,previous.occurred_at,reason,previous.currency,id])).rows[0];
      await audit(db, actor.id, "Movimiento de caja anulado", entry.id, previous, entry);
      await changed(db, "admins");
      return entry;
    });
  });
  app.post("/api/register/closings", request => {
    closer(request.actor!);
    return write(request, async (db, actor) => {
      closer(actor);
      const body = z.object({ period: periodSchema, fingerprint: z.string().length(64), opening: amount,
        counts: z.record(z.string(), z.number().int().min(0).max(1000000)),
        actual_sinpe: z.null().optional(), actual_card: z.null().optional(), note: z.string().trim().max(1000),
        supersedes: uuid.nullable(), confirmed: z.literal(true) }).strict().parse(request.body);
      const allowed = cashGroups.flatMap(g => [...g.values]).map(String);
      need(Object.keys(body.counts).every(k => allowed.includes(k)), 400, "Denominación de efectivo desconocida");
      need(config.currency === "CRC", 400, "El contador de denominaciones está configurado para colones costarricenses");
      const actualCash = safe(Object.entries(body.counts).reduce((n,[value,count]) => n + Number(value)*count*100, 0));
      const data = await snapshot(db, body.period);
      need(digest(JSON.stringify(data)) === body.fingerprint, 409, "El resumen cambió. Actualízalo y revisa la diferencia antes de guardar");
      const expected = safe(body.opening + data.collected.cash + data.movements.cash);
      const difference = safe(actualCash-expected);
      need((difference === 0 && !data.unclassified) || body.note.length >= 3, 400,
        "Añade una observación para guardar un cierre con diferencias o pagos sin clasificar");
      if (body.supersedes) {
        const prev = (await db.query("SELECT * FROM cash_closings WHERE id=$1", [body.supersedes])).rows[0];
        need(!prev || actor.role === "admin" || prev.actor_id === actor.id,403,"Solo puedes revisar tus propios cierres de caja");
        need(prev && prev.period_from.toISOString() === data.period.from && prev.period_to.toISOString() === data.period.to && prev.currency === data.currency,
          400, "La revisión debe conservar el mismo intervalo y moneda del cierre anterior");
      }
      const result = (await db.query(`INSERT INTO cash_closings(actor_id,period_from,period_to,currency,snapshot,count,opening,
        actual_cash,actual_sinpe,actual_card,expected_cash,difference_cash,note,supersedes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [actor.id,data.period.from,data.period.to,data.currency,JSON.stringify(data),JSON.stringify(body.counts),body.opening,
          actualCash,null,null,expected,difference,body.note,body.supersedes])).rows[0];
      await audit(db, actor.id, "Cierre de caja guardado", result.id, null,
        { period: data.period, opening: body.opening, actual_cash: actualCash, expected_cash: expected, difference_cash: difference, supersedes: body.supersedes });
      await changed(db, "user", actor.id);
      return visibleClosing({ ...result, actor_name: actor.name },actor);
    });
  });
  app.get("/api/register/closings", async request => {
    closer(request.actor!);
    const q = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(),
      offset: z.coerce.number().int().min(0).max(1000000).default(0) }).parse(request.query);
    const { rows } = await pool.query(`SELECT c.id,c.actor_id,c.created_at,c.period_from,c.period_to,c.currency,c.opening,
      c.actual_cash,c.expected_cash,c.difference_cash,c.supersedes,u.name AS actor_name
      FROM cash_closings c JOIN users u ON u.id=c.actor_id
      WHERE ($5::boolean OR c.actor_id=$6)
      AND ($1::date IS NULL OR c.period_from >= ($1::timestamp AT TIME ZONE $3))
      AND ($2::date IS NULL OR c.period_from < (($2::date+1)::timestamp AT TIME ZONE $3))
      ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET $4`, [q.from || null,q.to || null,config.timezone,q.offset,request.actor!.role === "admin",request.actor!.id]);
    return { rows: rows.slice(0,50), has_more: rows.length > 50 };
  });
  app.get("/api/register/closings/:id", async request => {
    closer(request.actor!);
    const id = uuid.parse((request.params as {id: string}).id);
    const row = (await pool.query(`SELECT c.*,u.name AS actor_name FROM cash_closings c JOIN users u ON u.id=c.actor_id WHERE c.id=$1 AND ($2::boolean OR c.actor_id=$3)`, [id,request.actor!.role === "admin",request.actor!.id])).rows[0];
    need(row, 404, "No se encontró el cierre de caja");
    return visibleClosing(row,request.actor!);
  });
}
