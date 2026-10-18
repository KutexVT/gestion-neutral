import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import sharp from "sharp";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import {
  pool,
  config,
  digest,
  Problem,
  need,
  mutation,
  transaction,
  audit,
  changed,
  title,
  uuid,
  version,
  type Actor,
  type DB,
} from "./db.js";
import {
  detail,
  createAccount,
  personal,
  consume,
  editAccount,
  closeAccount,
  changeFinal,
} from "./accounts.js";

import { registerReports, reportFilters } from "./reports.js";

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
const userFields = "id,username,name,role,active,created_at";
const admin = (request: FastifyRequest) => {
  need(
    request.actor?.role === "admin",
    403,
    "Esta acción es exclusiva del dueño",
  );
};
const resourceId = (request: FastifyRequest) =>
  uuid.parse((request.params as { id: string }).id);
const productInput = z
  .object({
    name: title,
    photo_id: uuid,
    price: z.number().int().min(0).max(1000000000),
    stock: z.number().int().min(0).max(1000000),
    active: z.boolean().default(true),
  })
  .strict();

async function currentActor(hash: string): Promise<Actor | null> {
  const {
    rows: [row],
  } = await pool.query(
    `SELECT u.id,u.name,u.username,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND u.active AND s.expires_at>now()`,
    [hash],
  );
  return row ? { ...row, sessionHash: hash } : null;
}

export async function buildApp({ logging = true, events = true } = {}) {
  const app = Fastify({
    logger: logging
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            'req.headers["x-csrf-token"]',
          ],
        }
      : false,
    bodyLimit: 1024 * 64,
    trustProxy: process.env.TRUST_PROXY === "true",
    requestTimeout: 20000,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "blob:", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.secure ? [] : null,
      },
    },
  });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  app.decorateRequest("actor", null);
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    const pathname = request.url.split("?")[0];
    const write = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (write)
      need(
        request.headers.origin === config.origin,
        403,
        "Origen de solicitud no permitido",
      );
    if (
      pathname === "/api/health" ||
      pathname === "/api/entry" ||
      (pathname === "/api/sellers" && request.method === "GET")
    )
      return;
    const token = request.cookies.gestion_session;
    request.actor = token ? await currentActor(digest(token)) : null;
    need(request.actor, 401, "Elige un perfil para continuar");
    if (write)
      need(
        request.headers["x-csrf-token"] === request.actor.csrf,
        403,
        "La sesión cambió. Recarga la página",
      );
  });
  app.setErrorHandler((error: any, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        message: "Revisa los datos ingresados",
        details: error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (error.code === "23505")
      return reply
        .code(409)
        .send({ message: "Ese usuario o registro ya existe" });
    if (error.code === "23503")
      return reply
        .code(400)
        .send({ message: "Uno de los registros relacionados no existe" });
    if (error.code === "23514" || error.code === "22003")
      return reply.code(400).send({
        message: "El importe o la cantidad excede el límite permitido",
      });
    if (["40P01", "55P03", "40001"].includes(error.code))
      return reply.code(409).send({
        message:
          "Otra operación está modificando estos datos. Revisa e intenta de nuevo",
      });
    const status = error.statusCode || 500;
    if (status >= 500) request.log.error({ err: error }, "Error de operación");
    reply.code(status).send({
      message:
        status >= 500
          ? "No se pudo completar la operación. Intenta de nuevo"
          : error.message,
      details: error.details,
    });
  });
  const write = (
    request: FastifyRequest,
    fn: (db: pg.PoolClient, actor: Actor) => Promise<unknown>,
  ) =>
    mutation(
      request.actor!,
      request.headers["idempotency-key"],
      digest(
        `${request.method}:${request.url}:${JSON.stringify(request.body ?? null)}`,
      ),
      (db) => fn(db, request.actor!),
    );

  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });
  app.post("/api/entry", async (request, reply) => {
    const body = z.object({ role: z.enum(["admin", "waiter"]), username: z.string().max(40).optional() }).strict().parse(request.body);
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const user = await transaction(async db => {
      const { rows: [user] } = await db.query(
        `SELECT ${userFields} FROM users WHERE role=$1 AND active
         AND ($2::text IS NULL OR username=$2) ORDER BY created_at,id LIMIT 1 FOR SHARE`,
        [body.role, body.username ?? null],
      );
      need(user, 404, "No hay un perfil disponible. El dueño puede crear un mesero en Equipo");
      if (request.cookies.gestion_session) {
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(request.cookies.gestion_session)]);
      }
      await db.query("DELETE FROM sessions WHERE expires_at<now()");
      await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')", [digest(token), user.id, csrf]);
      return user;
    });
    reply.setCookie("gestion_session", token, { path: "/", httpOnly: true, secure: config.secure, sameSite: "strict", maxAge: 12 * 3600 });
    return { user, csrf, config: publicConfig };
  });
  app.get("/api/me", async (request) => {
    const { sessionHash: _, csrf, ...user } = request.actor!;
    return { user, csrf, config: publicConfig };
  });
  app.post("/api/logout", async (request, reply) => {
    await transaction(async (db) => {
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        request.actor!.sessionHash,
      ]);
      await changed(db, "user", request.actor!.id);
    });
    reply.clearCookie("gestion_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/products", async (request) => {
    return (
      await pool.query(
        `SELECT * FROM products ${request.actor!.role === "admin" ? "" : "WHERE active"} ORDER BY name,id`,
      )
    ).rows;
  });
  app.get("/api/photos/:id", async (request, reply) => {
    const {
      rows: [photo],
    } = await pool.query("SELECT bytes FROM photos WHERE id=$1", [
      resourceId(request),
    ]);
    need(photo, 404, "Foto no encontrada");
    return reply.type("image/webp").send(photo.bytes);
  });
  app.post("/api/photos", async (request) => {
    admin(request);
    const part = await request.file();
    need(part, 400, "Selecciona una foto");
    const input = await part.toBuffer();
    need(!part.file.truncated, 413, "La foto debe pesar menos de 5 MB");
    let bytes: Buffer;
    try {
      const info = await sharp(input, {
        limitInputPixels: 20_000_000,
      }).metadata();
      need(
        ["jpeg", "png", "webp"].includes(info.format || ""),
        400,
        "Usa una foto JPG, PNG o WebP",
      );
      bytes = await sharp(input, { limitInputPixels: 20_000_000 })
        .rotate()
        .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new Problem(
        400,
        "La foto debe ser JPG, PNG o WebP y tener como máximo 20 megapíxeles",
      );
    }
    return transaction(async (db) => {
      const actor = await currentActor(request.actor!.sessionHash);
      need(actor?.role === "admin", 401, "Tu sesión terminó");
      const {
        rows: [photo],
      } = await db.query(
        "INSERT INTO photos(bytes,created_by) VALUES($1,$2) RETURNING id",
        [bytes, actor.id],
      );
      return photo;
    });
  });
  app.post("/api/products", async (request) => {
    admin(request);
    const body = productInput.parse(request.body);
    return write(request, async (db, actor) => {
      const {
        rows: [product],
      } = await db.query(
        `INSERT INTO products(name,photo_id,price,stock,active,currency) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          body.name,
          body.photo_id,
          body.price,
          body.stock,
          body.active,
          config.currency,
        ],
      );
      await db.query(
        `INSERT INTO stock_moves(product_id,actor_id,delta,stock_before,stock_after,reason) VALUES($1,$2,$3,0,$3,'Inventario inicial')`,
        [product.id, actor.id, body.stock],
      );
      await audit(db, actor.id, "Producto creado", product.id, null, product);
      await changed(db, "all");
      return product;
    });
  });
  app.post("/api/products/:id/stock", async (request) => {
    admin(request);
    const id = resourceId(request);
    const body = z.object({ quantity: z.number().int().min(1).max(1000000) }).strict().parse(request.body);
    return write(request, async (db, actor) => {
      const { rows: [before] } = await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [id]);
      need(before, 404, "No se encontró el producto");
      need(before.stock + body.quantity <= 1000000, 400, "El inventario no puede superar 1 000 000 de unidades");
      const { rows: [product] } = await db.query(
        "UPDATE products SET stock=stock+$2,version=version+1 WHERE id=$1 RETURNING *",
        [id, body.quantity],
      );
      await db.query(
        "INSERT INTO stock_moves(product_id,actor_id,delta,stock_before,stock_after,reason) VALUES($1,$2,$3,$4,$5,'Entrada de inventario')",
        [id, actor.id, body.quantity, before.stock, product.stock],
      );
      await audit(db, actor.id, "Existencias añadidas", id, { stock: before.stock }, { stock: product.stock, quantity: body.quantity });
      await changed(db, "all");
      return product;
    });
  });
  app.patch("/api/products/:id", async (request) => {
    admin(request);
    const body = productInput.extend({ version }).parse(request.body);
    const id = resourceId(request);
    return write(request, async (db, actor) => {
      const {
        rows: [before],
      } = await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [id]);
      need(before, 404, "No se encontró el producto");
      need(
        before.version === body.version,
        409,
        "El producto cambió. Revisa las existencias actuales",
      );
      const {
        rows: [product],
      } = await db.query(
        `UPDATE products SET name=$2,photo_id=$3,price=$4,stock=$5,active=$6,version=version+1 WHERE id=$1 RETURNING *`,
        [id, body.name, body.photo_id, body.price, body.stock, body.active],
      );
      await audit(db, actor.id, "Producto actualizado", id, before, product);
      if (before.stock !== body.stock) {
        await db.query(
          `INSERT INTO stock_moves(product_id,actor_id,delta,stock_before,stock_after,reason) VALUES($1,$2,$3,$4,$5,'Ajuste manual')`,
          [id, actor.id, body.stock - before.stock, before.stock, body.stock],
        );
        await audit(
          db,
          actor.id,
          "Inventario ajustado",
          id,
          { stock: before.stock },
          { stock: body.stock },
        );
      }
      await changed(db, "all");
      return product;
    });
  });

  app.get("/api/accounts", async (request) => {
    const q = z
      .object({
        kind: z.enum(["customer", "personal"]).default("customer"),
        scope: z.enum(["all", "mine", "others"]).default("all"),
        status: z.enum(["active", "closed", "all"]).default("active"),
        search: z.string().max(100).default(""),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .parse(request.query);
    const actor = request.actor!;
    const { rows } = await pool.query(
      `SELECT a.*,u.name AS creator_name FROM accounts a JOIN users u ON u.id=a.created_by
      WHERE a.kind=$1 AND ($2='all' OR ($2='active' AND closed_at IS NULL) OR ($2='closed' AND closed_at IS NOT NULL))
      AND ($3::boolean OR (a.kind='customer' AND closed_at IS NULL) OR a.created_by=$4)
      AND (a.name ILIKE $5 OR u.name ILIKE $5)
      AND ($7='all' OR ($7='mine' AND a.created_by=$4) OR ($7='others' AND a.created_by<>$4))
      ORDER BY a.arrived_at DESC,a.id LIMIT 101 OFFSET $6`,
      [
        q.kind,
        q.status,
        actor.role === "admin",
        actor.id,
        `%${q.search}%`,
        q.offset,
        q.scope,
      ],
    );
    return { rows: rows.slice(0, 100), has_more: rows.length > 100 };
  });
  app.get("/api/accounts/:id", async (request) =>
    detail(pool, resourceId(request), request.actor!),
  );
  app.post("/api/accounts", (request) =>
    write(request, (db, actor) => createAccount(db, actor, request.body)),
  );
  app.post("/api/personal", (request) =>
    write(request, (db, actor) => personal(db, actor)),
  );
  app.post("/api/accounts/:id/consumption", (request) =>
    write(request, (db, actor) =>
      consume(db, actor, resourceId(request), request.body),
    ),
  );
  app.patch("/api/accounts/:id", (request) =>
    write(request, (db, actor) =>
      editAccount(db, actor, resourceId(request), request.body),
    ),
  );
  app.post("/api/accounts/:id/close", (request) =>
    write(request, (db, actor) =>
      closeAccount(db, actor, resourceId(request), request.body),
    ),
  );
  app.patch("/api/accounts/:id/final", (request) =>
    write(request, (db, actor) =>
      changeFinal(db, actor, resourceId(request), request.body),
    ),
  );

  app.get("/api/users", async (request) => {
    admin(request);
    return (
      await pool.query(`SELECT u.id,u.username,u.name,u.role,u.active,u.created_at,
    a.id AS personal_account_id,a.calculated_total AS personal_total,a.currency AS personal_currency
    FROM users u LEFT JOIN accounts a ON a.created_by=u.id AND a.kind='personal' ORDER BY u.active DESC,u.name`)
    ).rows;
  });
  app.post("/api/users", async (request) => {
    admin(request);
    const body = z
      .object({
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_.-]{3,40}$/),
        name: title,
      })
      .strict()
      .parse(request.body);
    return write(request, async (db, actor) => {
      const {
        rows: [user],
      } = await db.query(
        `INSERT INTO users(username,name,role) VALUES($1,$2,'waiter') RETURNING ${userFields}`,
        [body.username, body.name],
      );
      await audit(db, actor.id, "Mesero creado", user.id, null, user);
      await changed(db, "admins");
      return user;
    });
  });
  app.delete("/api/users/:id", async (request) => {
    admin(request);
    const id = resourceId(request);
    return write(request, async (db, actor) => {
      const {
        rows: [user],
      } = await db.query(
        `UPDATE users SET active=false WHERE id=$1 AND role='waiter' AND active RETURNING ${userFields}`,
        [id],
      );
      need(user, 404, "Mesero activo no encontrado");
      await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(
        db,
        actor.id,
        "Mesero eliminado",
        id,
        { active: true },
        { active: false, name: user.name },
      );
      await changed(db, "user", id);
      return { ok: true };
    });
  });
  registerReports(app);
  app.get("/api/audit", async (request) => {
    admin(request);
    const q = z
      .object({ before: z.coerce.number().int().positive().optional() })
      .parse(request.query);
    const filters = reportFilters.parse(request.query);
    const { rows } = await pool.query(
      `SELECT a.*,u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor_id
      WHERE ($1::bigint IS NULL OR (a.created_at,a.id)<(SELECT b.created_at,b.id FROM audit b WHERE b.id=$1))
      AND ($2::date IS NULL OR a.created_at >= ($2::date::timestamp AT TIME ZONE $4))
      AND ($3::date IS NULL OR a.created_at < (($3::date+1)::timestamp AT TIME ZONE $4))
      AND ($5::uuid IS NULL OR a.actor_id=$5)
      ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,
      [
        q.before || null,
        filters.from || null,
        filters.to || null,
        config.timezone,
        filters.seller || null,
      ],
    );
    return { rows: rows.slice(0, 50), has_more: rows.length > 50 };
  });

  const streams = new Set<{
    response: ServerResponse;
    actor: Actor;
    timer: NodeJS.Timeout;
  }>();
  const disconnect = (
    stream: typeof streams extends Set<infer T> ? T : never,
  ) => {
    clearInterval(stream.timer);
    streams.delete(stream);
    stream.response.end();
  };
  const broadcast = async (change: { scope: string; userId?: string }) => {
    for (const stream of streams) {
      if (!(
        change.scope === "all" ||
        stream.actor.role === "admin" ||
        change.userId === stream.actor.id
      ))
        continue;
      try {
        if (!(await currentActor(stream.actor.sessionHash))) {
          stream.response.write("event: revoked\ndata: {}\n\n");
          disconnect(stream);
        } else stream.response.write("event: change\ndata: {}\n\n");
      } catch {
        disconnect(stream);
      }
    }
  };
  let listener: pg.Client | undefined;
  let stopping = false;
  let retry: NodeJS.Timeout | undefined;
  async function listen() {
    if (stopping) return;
    const client = new pg.Client({
      connectionString: config.database,
      connectionTimeoutMillis: 5000,
    });
    listener = client;
    let failed = false;
    const reconnect = () => {
      if (failed || stopping) return;
      failed = true;
      for (const stream of streams) disconnect(stream);
      void client.end().catch(() => {});
      retry = setTimeout(() => void listen(), 2000);
    };
    client.on("error", reconnect);
    client.on("end", reconnect);
    client.on("notification", (message) => {
      if (message.payload) void broadcast(JSON.parse(message.payload));
    });
    try {
      await client.connect();
      await client.query("LISTEN gestion_changes");
      await broadcast({ scope: "all" });
    } catch {
      reconnect();
    }
  }
  app.get("/api/events", async (request, reply) => {
    need(streams.size < 300, 503, "Demasiadas pantallas conectadas");
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 2000\nevent: change\ndata: {}\n\n");
    const stream = {
      response: reply.raw,
      actor: request.actor!,
      timer: setInterval(() => {
        void currentActor(request.actor!.sessionHash)
          .then((actor) => {
            if (!actor) {
              reply.raw.write("event: revoked\ndata: {}\n\n");
              disconnect(stream);
            } else reply.raw.write(": conectado\n\n");
          })
          .catch(() => disconnect(stream));
      }, 15000),
    };
    streams.add(stream);
    reply.raw.on("close", () => {
      clearInterval(stream.timer);
      streams.delete(stream);
    });
  });
  app.addHook("onReady", async () => {
    if (events) await listen();
  });
  app.addHook("preClose", async () => {
    stopping = true;
    clearTimeout(retry);
    for (const stream of streams) disconnect(stream);
    await listener?.end();
  });

  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  if (existsSync(root)) {
    await app.register(staticFiles, { root });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply.code(404).send({ message: "Ruta no encontrada" })
        : reply.header("Cache-Control", "no-cache").sendFile("index.html"),
    );
  }
  return app;
}

const publicConfig = {
  name: config.name,
  currency: config.currency,
  timezone: config.timezone,
};
