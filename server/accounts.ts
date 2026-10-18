import { z } from "zod";
import {
  audit,
  changed,
  config,
  need,
  Problem,
  title,
  uuid,
  version,
  amount,
  type Actor,
  type DB,
} from "./db.js";

export async function detail(db: DB, id: string, actor: Actor) {
  const {
    rows: [account],
  } = await db.query(
    `SELECT a.*, u.name AS creator_name, x.name AS adjusted_by_name
    FROM accounts a JOIN users u ON u.id=a.created_by LEFT JOIN users x ON x.id=a.adjusted_by WHERE a.id=$1`,
    [id],
  );
  need(account, 404, "No se encontró la cuenta");
  need(
    account.kind === "customer" ||
      account.created_by === actor.id ||
      actor.role === "admin",
    403,
    "Este consumo es privado",
  );
  need(
    !account.closed_at ||
      account.created_by === actor.id ||
      actor.role === "admin",
    403,
    "No puedes consultar esta cuenta cerrada",
  );
  const { rows: items } = await db.query(
    `SELECT c.*, u.name AS waiter_name FROM consumption c
    JOIN users u ON u.id=c.recorded_by WHERE account_id=$1 AND quantity>0 ORDER BY recorded_at,id`,
    [id],
  );
  const { rows: invoices } = await db.query(
    "SELECT * FROM invoices WHERE account_id=$1 ORDER BY revision DESC",
    [id],
  );
  return { ...account, items, invoices };
}

async function lock(
  db: DB,
  id: string,
  expected: number,
  actor: Actor,
  manager = false,
) {
  const {
    rows: [account],
  } = await db.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [id]);
  need(account, 404, "No se encontró la cuenta");
  const own = account.created_by === actor.id;
  need(
    actor.role === "admin" ||
      (account.kind === "personal" ? own : !account.closed_at),
    403,
    "No puedes modificar esta cuenta",
  );
  if (manager)
    need(
      actor.role === "admin" || own,
      403,
      "Solo el creador o el dueño puede gestionar toda la cuenta",
    );
  need(
    account.version === expected,
    409,
    "La cuenta cambió en otra pantalla. Revisa los datos actualizados antes de confirmar",
  );
  return account;
}

export async function invoice(db: DB, id: string, actor: Actor) {
  const data = await detail(db, id, actor);
  const { invoices, ...snapshot } = data;
  await db.query(
    "INSERT INTO invoices(account_id,revision,snapshot,created_by) VALUES($1,$2,$3,$4)",
    [
      id,
      (invoices[0]?.revision || 0) + 1,
      JSON.stringify({
        ...snapshot,
        bar_name: config.name,
        timezone: config.timezone,
      }),
      actor.id,
    ],
  );
}

export async function createAccount(db: DB, actor: Actor, body: unknown) {
  const { name } = z.object({ name: title }).strict().parse(body);
  const {
    rows: [account],
  } = await db.query(
    `INSERT INTO accounts(kind,name,created_by,currency)
    VALUES('customer',$1,$2,$3) RETURNING *`,
    [name, actor.id, config.currency],
  );
  await audit(db, actor.id, "Cliente creado", account.id, null, account);
  await changed(db, "all");
  return account;
}

export async function personal(db: DB, actor: Actor) {
  need(
    actor.role === "waiter",
    403,
    "El consumo personal corresponde a meseros",
  );
  const { rows } = await db.query(
    `INSERT INTO accounts(kind,name,created_by,currency) VALUES('personal',$1,$2,$3)
    ON CONFLICT (created_by) WHERE kind='personal' DO NOTHING RETURNING *`,
    [actor.name, actor.id, config.currency],
  );
  if (rows.length) {
    await audit(
      db,
      actor.id,
      "Consumo personal abierto",
      rows[0].id,
      null,
      rows[0],
    );
    await changed(db, "user", actor.id);
  }
  return (
    await db.query(
      "SELECT * FROM accounts WHERE kind='personal' AND created_by=$1",
      [actor.id],
    )
  ).rows[0];
}

const consumptionBody = z
  .object({
    version,
    add: z
      .array(
        z
          .object({
            product_id: uuid,
            quantity: z.number().int().min(1).max(100000),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    set: z
      .array(
        z
          .object({ id: uuid, quantity: z.number().int().min(0).max(100000) })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();

export async function consume(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const body = consumptionBody.parse(input);
  need(
    body.add.length + body.set.length,
    400,
    "Selecciona al menos un producto",
  );
  need(
    new Set(body.add.map((x) => x.product_id)).size === body.add.length &&
      new Set(body.set.map((x) => x.id)).size === body.set.length,
    400,
    "No repitas productos o líneas en la misma operación",
  );
  const account = await lock(db, id, body.version, actor);
  const before = await detail(db, id, actor);
  const items = new Map<string, any>(before.items.map((x: any) => [x.id, x]));
  const delta = new Map<string, number>();
  for (const edit of body.set) {
    const item = items.get(edit.id);
    need(item, 400, "El consumo que intentas corregir no existe");
    need(
      actor.role === "admin" ||
        account.created_by === actor.id ||
        item.recorded_by === actor.id,
      403,
      "Solo puedes corregir tus propias entregas en cuentas ajenas",
    );
    delta.set(
      item.product_id,
      (delta.get(item.product_id) || 0) + edit.quantity - item.quantity,
    );
  }
  for (const item of body.add)
    delta.set(
      item.product_id,
      (delta.get(item.product_id) || 0) + item.quantity,
    );
  const { rows } = await db.query(
    "SELECT * FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [[...delta.keys()].sort()],
  );
  const products = new Map<string, any>(rows.map((p) => [p.id, p]));
  for (const [pid, count] of delta) {
    const product = products.get(pid);
    need(product, 400, "Uno de los productos ya no existe");
    const adds =
      body.add.some((i) => i.product_id === pid) ||
      body.set.some(
        (e) =>
          items.get(e.id).product_id === pid &&
          e.quantity > items.get(e.id).quantity,
      );
    if (adds) {
      need(product.active, 409, `${product.name} está desactivado`);
      need(
        product.currency === account.currency,
        400,
        "No se pueden mezclar monedas en una cuenta",
      );
    }
    if (product.stock < count)
      throw new Problem(
        409,
        `No hay suficientes unidades de ${product.name}. Disponibles: ${product.stock}`,
        { product_id: pid, available: product.stock },
      );
    need(
      product.stock - count <= 1000000,
      400,
      "El ajuste excede el límite de inventario",
    );
  }
  const stock = [];
  for (const [pid, count] of delta) {
    const product = products.get(pid);
    if (count !== 0) {
      await db.query(
        "UPDATE products SET stock=stock-$2,version=version+1 WHERE id=$1",
        [pid, count],
      );
      await db.query(
        `INSERT INTO stock_moves(product_id,account_id,actor_id,delta,stock_before,stock_after,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          pid,
          id,
          actor.id,
          -count,
          product.stock,
          product.stock - count,
          account.kind === "personal"
            ? "Consumo personal"
            : "Consumo de cliente",
        ],
      );
    }
    stock.push({ id: pid, name: product.name, stock: product.stock - count });
  }
  for (const edit of body.set)
    await db.query("UPDATE consumption SET quantity=$2 WHERE id=$1", [
      edit.id,
      edit.quantity,
    ]);
  for (const item of body.add) {
    const product = products.get(item.product_id);
    await db.query(
      `INSERT INTO consumption(account_id,product_id,product_name,unit_price,quantity,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [id, product.id, product.name, product.price, item.quantity, actor.id],
    );
  }
  await db.query(
    `UPDATE accounts SET calculated_total=(SELECT COALESCE(sum(unit_price::bigint*quantity),0)
    FROM consumption WHERE account_id=$1),version=version+1 WHERE id=$1`,
    [id],
  );
  if (account.closed_at) await invoice(db, id, actor);
  const after = await detail(db, id, actor);
  // Invoices already have immutable snapshots; audit only the changed account and lines.
  await audit(
    db,
    actor.id,
    account.kind === "personal"
      ? "Consumo personal corregido"
      : "Consumo de cliente actualizado",
    id,
    { ...before, invoices: undefined },
    { ...after, invoices: undefined },
  );
  await changed(db, "all"); // Stock is public to signed-in staff; the payload has no personal data.
  return { account: after, stock };
}

export async function editAccount(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const body = z
    .object({
      version,
      name: title,
      arrived_at: z.iso.datetime({ offset: true }).optional(),
      closed_at: z.iso.datetime({ offset: true }).optional(),
    })
    .strict()
    .parse(input);
  const account = await lock(db, id, body.version, actor, true);
  need(
    account.kind === "customer",
    400,
    "Los datos personales se administran desde usuarios",
  );
  if (body.arrived_at || body.closed_at)
    need(actor.role === "admin", 403, "Solo el dueño puede corregir horarios");
  const arrival = body.arrived_at
    ? new Date(body.arrived_at)
    : account.arrived_at;
  const departure = body.closed_at
    ? new Date(body.closed_at)
    : account.closed_at;
  need(
    !body.closed_at || account.closed_at,
    400,
    "Usa Finalizar cuenta para registrar una salida",
  );
  need(
    arrival <= new Date() &&
      (!departure || (departure >= arrival && departure <= new Date())),
    400,
    "Revisa los horarios de llegada y salida",
  );
  await db.query(
    "UPDATE accounts SET name=$2,arrived_at=$3,closed_at=$4,version=version+1 WHERE id=$1",
    [id, body.name, arrival, departure],
  );
  if (account.closed_at) await invoice(db, id, actor);
  const result = await detail(db, id, actor);
  await audit(db, actor.id, "Datos del cliente corregidos", id, account, {
    ...result,
    items: undefined,
    invoices: undefined,
  });
  await changed(db, "all");
  return result;
}

export async function closeAccount(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const body = z
    .object({
      version,
      final_total: amount.nullable(),
      confirmed: z.literal(true),
      cash_received: amount.optional(),
    })
    .strict()
    .parse(input);
  const account = await lock(db, id, body.version, actor, true);
  need(
    account.kind === "customer" && !account.closed_at,
    409,
    "Esta cuenta ya está cerrada o es un consumo personal",
  );
  const finalTotal = body.final_total ?? account.calculated_total;
  const received = body.cash_received ?? finalTotal;
  need(
    received >= finalTotal,
    400,
    "El efectivo recibido no alcanza para pagar la cuenta",
  );
  await db.query(
    `UPDATE accounts SET closed_at=now(),closed_by=$2,final_total=$3,adjusted_by=$4,cash_received=$5,cash_change=$6,version=version+1 WHERE id=$1`,
    [
      id,
      actor.id,
      body.final_total ?? account.calculated_total,
      body.final_total === null ? null : actor.id,
      received,
      received - finalTotal,
    ],
  );
  await invoice(db, id, actor);
  const result = await detail(db, id, actor);
  await audit(db, actor.id, "Cliente cerrado", id, account, {
    ...result,
    invoices: undefined,
  });
  if (body.final_total !== null)
    await audit(
      db,
      actor.id,
      "Precio final cambiado",
      id,
      { calculated_total: account.calculated_total },
      { final_total: body.final_total, adjusted_by: actor.id },
    );
  await changed(db, "all");
  return result;
}

export async function changeFinal(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  need(
    actor.role === "admin",
    403,
    "Solo el dueño puede corregir el total cobrado",
  );
  const body = z
    .object({ version, final_total: amount, confirmed: z.literal(true) })
    .strict()
    .parse(input);
  const account = await lock(db, id, body.version, actor, true);
  need(account.closed_at, 400, "Primero finaliza la cuenta");
  await db.query(
    "UPDATE accounts SET final_total=$2,adjusted_by=$3,version=version+1 WHERE id=$1",
    [id, body.final_total, actor.id],
  );
  await invoice(db, id, actor);
  await audit(
    db,
    actor.id,
    "Precio final cambiado",
    id,
    { final_total: account.final_total },
    { final_total: body.final_total, adjusted_by: actor.id },
  );
  await changed(db, "all");
  return detail(db, id, actor);
}
