import pg from "pg";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Importe fuera de rango");
  return n;
});
export const config = {
  database: process.env.DATABASE_URL || "",
  origin: process.env.APP_ORIGIN || "http://localhost:3182",
  secure: process.env.SECURE_COOKIES === "true",
  name: process.env.APP_NAME || "Gestión",
  currency: process.env.CURRENCY || "CRC",
  timezone: process.env.TIME_ZONE || "America/Costa_Rica",
};
if (!config.database)
  throw new Error(
    "Falta DATABASE_URL. Ejecuta npm run setup o configura el entorno",
  );
if (!/^[A-Z]{3}$/.test(config.currency))
  throw new Error("CURRENCY debe ser un código ISO de tres letras");
new Intl.DateTimeFormat("es-CR", { timeZone: config.timezone });
new Intl.NumberFormat("es-CR", {
  style: "currency",
  currency: config.currency,
});
if (
  process.env.NODE_ENV === "production" &&
  (!config.secure || !config.origin.startsWith("https://"))
) {
  throw new Error(
    "Producción requiere APP_ORIGIN=https://… y SECURE_COOKIES=true",
  );
}
export const pool = new pg.Pool({
  connectionString: config.database,
  max: 15,
  connectionTimeoutMillis: 5000,
});
pool.on("error", (error) =>
  console.error("Conexión PostgreSQL:", error.message),
);
export type DB = Pick<pg.PoolClient, "query">;
export type Actor = {
  id: string;
  name: string;
  username: string;
  role: "admin" | "waiter";
  sessionHash: string;
  csrf: string;
};
export class Problem extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function need(
  condition: unknown,
  code: number,
  message: string,
): asserts condition {
  if (!condition) throw new Problem(code, message);
}
export const uuid = z.string().uuid();
export const title = z.string().trim().min(1).max(100);
export const version = z.number().int().positive();
export const amount = z.number().int().min(0).max(9_000_000_000_000);
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout = '8s'");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function migrate() {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(734831)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
    for (const file of (await readdir(directory))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        (await db.query("SELECT 1 FROM migrations WHERE name=$1", [file]))
          .rowCount
      )
        continue;
      await db.query(await readFile(`${directory}/${file}`, "utf8"));
      await db.query("INSERT INTO migrations(name) VALUES ($1)", [file]);
    }
  });
}

export async function audit(
  db: DB,
  actor: string,
  action: string,
  entity: string | null,
  before: unknown,
  after: unknown,
) {
  await db.query(
    "INSERT INTO audit(actor_id,action,entity_id,before_value,after_value) VALUES($1,$2,$3,$4,$5)",
    [
      actor,
      action,
      entity,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ],
  );
}

export async function changed(
  db: DB,
  scope: "all" | "admins" | "user",
  userId?: string,
) {
  await db.query("SELECT pg_notify('gestion_changes', $1)", [
    JSON.stringify({ scope, userId }),
  ]);
}

export async function mutation(
  actor: Actor,
  key: unknown,
  fingerprint: string,
  fn: (db: pg.PoolClient) => Promise<unknown>,
) {
  const operationKey = uuid.parse(key);
  return transaction(async (db) => {
    const valid = await db.query(
      `SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active FOR SHARE OF u,s`,
      [actor.sessionHash],
    );
    need(valid.rowCount, 401, "Tu sesión terminó. Vuelve a ingresar");
    const inserted = await db.query(
      `INSERT INTO operations(actor_id,key,fingerprint) VALUES($1,$2,$3)
      ON CONFLICT DO NOTHING RETURNING key`,
      [actor.id, operationKey, fingerprint],
    );
    if (!inserted.rowCount) {
      const {
        rows: [previous],
      } = await db.query(
        "SELECT * FROM operations WHERE actor_id=$1 AND key=$2",
        [actor.id, operationKey],
      );
      need(
        previous.fingerprint === fingerprint,
        409,
        "Este identificador ya pertenece a otra operación",
      );
      return previous.result;
    }
    const result = await fn(db);
    await db.query(
      "UPDATE operations SET result=$3 WHERE actor_id=$1 AND key=$2",
      [actor.id, operationKey, JSON.stringify(result)],
    );
    return result;
  });
}
