import sharp from "sharp";
import { buildApp } from "../server/app.js";
import {
  pool,
  migrate,
  config,
  transaction,
  type Actor,
} from "../server/db.js";
import { consume } from "../server/accounts.js";

if (
  !/\/bar_test_/.test(new URL(config.database).pathname)
)
  throw new Error(
    "La vista de pruebas solo admite una base temporal",
  );
await migrate();
const actors: Actor[] = [];
for (const [username, name, role] of [
  ["dueno", "Mikel", "admin"],
  ["ana", "Ana Torres", "waiter"],
  ["leo", "Leo Vega", "waiter"],
]) {
  const {
    rows: [user],
  } = await pool.query(
    "INSERT INTO users(username,name,role) VALUES($1,$2,$3) RETURNING id,name,username,role",
    [username, name, role],
  );
  actors.push({ ...user, sessionHash: "", csrf: "" });
}
const products: { id: string }[] = [];
for (const [name, price, stock, color, beverage] of [
  ["Cerveza artesanal", 250000, 24, "#d8c392", "#be852d"],
  ["Vino tinto", 380000, 15, "#ceb1ac", "#862f3a"],
  ["Agua mineral", 150000, 18, "#afc7c7", "#9fd0d4"],
  ["Mojito de la casa", 450000, 12, "#b9c6a0", "#a8bd56"],
] as const) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><defs><radialGradient id="bg"><stop stop-color="#fff7e7"/><stop offset="1" stop-color="${color}"/></radialGradient><linearGradient id="g"><stop stop-color="${beverage}"/><stop offset="1" stop-color="${beverage}" stop-opacity=".6"/></linearGradient></defs><rect width="600" height="400" fill="url(#bg)"/><ellipse cx="305" cy="353" rx="106" ry="17" fill="#302317" opacity=".12"/><path d="M219 60 L240 324 Q300 357 360 324 L381 60Z" fill="#ffffff" opacity=".42" stroke="white" stroke-width="3"/><path d="M225 108 L243 320 Q300 350 357 320 L375 108Z" fill="url(#g)"/><ellipse cx="300" cy="108" rx="75" ry="15" fill="#fff8df" opacity=".8"/><path d="M237 87 L252 310" stroke="white" stroke-width="9" opacity=".35"/><circle cx="330" cy="210" r="6" fill="white" opacity=".2"/><circle cx="282" cy="165" r="4" fill="white" opacity=".35"/><circle cx="285" cy="279" r="3" fill="white" opacity=".4"/></svg>`;
  const bytes = await sharp(Buffer.from(svg)).webp().toBuffer();
  const {
    rows: [photo],
  } = await pool.query(
    "INSERT INTO photos(bytes,created_by) VALUES($1,$2) RETURNING id",
    [bytes, actors[0].id],
  );
  const {
    rows: [product],
  } = await pool.query(
    "INSERT INTO products(name,photo_id,price,stock,currency) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [name, photo.id, price, stock, config.currency],
  );
  products.push(product);
}
for (const [index, name] of [
  "Camila Rojas",
  "Diego Mora",
  "Valeria Solís",
  "Andrés Vargas",
  "Sofía Jiménez",
  "Mateo Castro",
].entries()) {
  const actor = actors[index < 3 ? 1 : 2];
  const {
    rows: [account],
  } = await pool.query(
    "INSERT INTO accounts(kind,name,created_by,currency,arrived_at) VALUES('customer',$1,$2,$3,now()-interval '20 minutes') RETURNING *",
    [name, actor.id, config.currency],
  );
  await transaction((db) =>
    consume(db, actor, account.id, {
      version: 1,
      add: [{ product_id: products[index % 4].id, quantity: 1 }],
    }),
  );
}
const app = await buildApp({ logging: false });
await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.QA_PORT || 3183),
});
console.log("Vista de pruebas disponible");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
