import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, need, pool, uuid } from "./db.js";

export const reportFilters = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    seller: uuid.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "La fecha final debe ser igual o posterior a la inicial",
  });
const paging = z.object({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
});

export function registerReports(app: FastifyInstance) {
  app.get("/api/sellers", async () => {
    const { rows } = await pool.query(
      "SELECT username,name FROM users WHERE active AND role='waiter' ORDER BY name,username",
    );
    return rows;
  });
  app.get("/api/report-sellers", async (request) => {
    const actor = request.actor!;
    const { rows } = await pool.query(
      "SELECT id,name,active FROM users WHERE ($1::boolean OR id=$2) ORDER BY name,id",
      [actor.role === "admin", actor.id],
    );
    return rows;
  });
  for (const route of ["sales", "cash-flow"]) {
    app.get(`/api/${route}`, async (request) => {
      const actor = request.actor!;
      if (route === "cash-flow")
        need(
          actor.role === "admin",
          403,
          "Solo el dueño puede consultar el flujo de efectivo",
        );
      const q = reportFilters.parse(request.query);
      const { offset } = paging.parse(request.query);
      need(
        actor.role === "admin" || !q.seller || q.seller === actor.id,
        403,
        "Solo puedes consultar tus ventas",
      );
      const seller = actor.role === "admin" ? q.seller : actor.id;
      const {
        rows: [report],
      } = await pool.query(
        `WITH sales AS (
          SELECT a.id,a.name,a.closed_at,a.closed_by,a.currency,a.calculated_total,a.final_total,
            a.cash_received,a.cash_change,u.name AS seller_name,
            to_char(a.closed_at AT TIME ZONE $3,'YYYY-MM-DD') AS day,
            (SELECT id FROM invoices i WHERE i.account_id=a.id ORDER BY revision DESC LIMIT 1) AS invoice_id
          FROM accounts a JOIN users u ON u.id=a.closed_by
          WHERE a.kind='customer' AND a.closed_at IS NOT NULL
            AND ($1::date IS NULL OR a.closed_at >= ($1::date::timestamp AT TIME ZONE $3))
            AND ($2::date IS NULL OR a.closed_at < (($2::date+1)::timestamp AT TIME ZONE $3))
            AND ($4::uuid IS NULL OR a.closed_by=$4)
        ), totals AS (
          SELECT currency,count(*)::int AS accounts,sum(calculated_total)::bigint AS calculated,
            sum(final_total)::bigint AS total,COALESCE(sum(cash_received),0)::bigint AS received,
            COALESCE(sum(cash_change),0)::bigint AS change,
            COALESCE(sum(cash_received-cash_change),0)::bigint AS cash_net,
            count(*) FILTER (WHERE cash_received IS NULL)::int AS unrecorded
          FROM sales GROUP BY currency
        ), daily AS (
          SELECT day,currency,count(*)::int AS accounts,sum(final_total)::bigint AS total,
            COALESCE(sum(cash_received-cash_change),0)::bigint AS cash_net
          FROM sales GROUP BY day,currency ORDER BY day DESC,currency
        ), sellers AS (
          SELECT closed_by AS id,seller_name AS name,currency,count(*)::int AS accounts,
            sum(final_total)::bigint AS total,COALESCE(sum(cash_received-cash_change),0)::bigint AS cash_net
          FROM sales GROUP BY closed_by,seller_name,currency ORDER BY seller_name,currency
        ), page AS (
          SELECT * FROM sales ORDER BY closed_at DESC,id LIMIT 101 OFFSET $5
        )
        SELECT COALESCE((SELECT json_agg(t) FROM totals t),'[]') AS totals,
          COALESCE((SELECT json_agg(d) FROM daily d),'[]') AS daily,
          COALESCE((SELECT json_agg(s) FROM sellers s),'[]') AS sellers,
          COALESCE((SELECT json_agg(p) FROM page p),'[]') AS rows`,
        [q.from || null, q.to || null, config.timezone, seller || null, offset],
      );
      // JSON aggregates bypass pg's bigint parser; reject amounts outside JS's exact integer range.
      for (const rows of [
        report.totals,
        report.daily,
        report.sellers,
        report.rows,
      ])
        for (const row of rows)
          for (const value of Object.values(row))
            if (typeof value === "number")
              need(
                Number.isSafeInteger(value),
                400,
                "Reduce el intervalo del reporte: el importe excede el límite permitido",
              );
      return {
        ...report,
        rows: report.rows.slice(0, 100),
        has_more: report.rows.length > 100,
      };
    });
  }
  app.get("/api/movements", async (request) => {
    need(
      request.actor!.role === "admin",
      403,
      "Solo el dueño puede consultar movimientos",
    );
    const q = reportFilters.parse(request.query);
    const { offset } = paging.parse(request.query);
    const { rows } = await pool.query(
      `SELECT m.*,p.name AS product_name,u.name AS seller_name,a.name AS account_name,a.kind
       FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.actor_id
       LEFT JOIN accounts a ON a.id=m.account_id
       WHERE ($1::date IS NULL OR m.created_at >= ($1::date::timestamp AT TIME ZONE $3))
         AND ($2::date IS NULL OR m.created_at < (($2::date+1)::timestamp AT TIME ZONE $3))
         AND ($4::uuid IS NULL OR m.actor_id=$4)
       ORDER BY m.created_at DESC,m.id DESC LIMIT 101 OFFSET $5`,
      [q.from || null, q.to || null, config.timezone, q.seller || null, offset],
    );
    return { rows: rows.slice(0, 100), has_more: rows.length > 100 };
  });
}
