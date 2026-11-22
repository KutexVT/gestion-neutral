import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { buildApp } from "../server/app.js";
import {
  pool,
  migrate,
  config,
} from "../server/db.js";
import { parseMoney } from "../web/api.js";

type Login = { cookie: string; csrf: string; id: string };
const app = await buildApp({ logging: false });
let owner: Login, first: Login, second: Login, photo: string;
let serverUrl: string;
const users: Record<string, string> = {};
async function login(username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/entry",
    headers: { origin: config.origin },
    payload: { username, role: username === "dueno" ? "admin" : "waiter" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    cookie: String(response.headers["set-cookie"]).split(";")[0],
    csrf: response.json().csrf,
    id: response.json().user.id,
  };
}
async function request(
  actor: Login,
  method: any,
  url: string,
  payload?: unknown,
  key = randomUUID(),
) {
  return app.inject({
    method,
    url: `/api${url}`,
    headers: {
      origin: config.origin,
      cookie: actor.cookie,
      "x-csrf-token": actor.csrf,
      "idempotency-key": key,
    },
    ...(payload === undefined ? {} : { payload: payload as any }),
  });
}
async function ok(
  actor: Login,
  method: string,
  url: string,
  payload?: unknown,
) {
  const response = await request(actor, method, url, payload);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function product(stock = 10, price = 125000) {
  return ok(owner, "POST", "/products", {
    name: `Producto ${randomBytes(3).toString("hex")}`,
    photo_id: photo,
    price,
    purchase_cost: 50000,
    stock,
  });
}
async function customer(actor = first) {
  return ok(actor, "POST", "/accounts", {
    name: `Cliente ${randomBytes(3).toString("hex")}`,
  });
}
async function account(id: string, actor = owner) {
  return ok(actor, "GET", `/accounts/${id}`);
}
async function stock(id: string) {
  return (await ok(owner, "GET", "/products")).find((p: any) => p.id === id)
    .stock;
}

before(async () => {
  assert.match(new URL(config.database).pathname, /\/bar_test_/);
  await migrate();
  await migrate();
  for (const [username, role] of [
    ["dueno", "admin"],
    ["ana", "waiter"],
    ["leo", "waiter"],
  ]) {
    const {
      rows: [user],
    } = await pool.query(
      "INSERT INTO users(username,name,role) VALUES($1,$1,$2) RETURNING id",
      [username, role],
    );
    users[username] = user.id;
  }
  await app.ready();
  serverUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  owner = await login("dueno");
  first = await login("ana");
  second = await login("leo");
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#809458" },
  })
    .webp()
    .toBuffer();
  photo = (
    await pool.query(
      "INSERT INTO photos(bytes,created_by) VALUES($1,$2) RETURNING id",
      [bytes, owner.id],
    )
  ).rows[0].id;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("selección de perfil, roles, CSRF y validación de entradas", async () => {
  const anonymous = await app.inject("/api/products");
  assert.equal(anonymous.statusCode, 401);
  for (const route of ["/users", "/audit"])
    assert.equal((await request(first, "GET", route)).statusCode, 403);
  assert.equal((await request(first, "POST", "/products", {})).statusCode, 403);
  assert.equal((await request(first, "POST", "/users", {})).statusCode, 403);
  const missingCsrf = await app.inject({
    method: "POST",
    url: "/api/accounts",
    headers: {
      cookie: first.cookie,
      origin: config.origin,
      "idempotency-key": randomUUID(),
    },
    payload: { name: "CSRF" },
  });
  assert.equal(missingCsrf.statusCode, 403);
  const foreignOrigin = await app.inject({
    method: "POST",
    url: "/api/entry",
    headers: { origin: "https://otro.invalid" },
    payload: { username: "ana", role: "waiter" },
  });
  assert.equal(foreignOrigin.statusCode, 403);
  assert.equal(
    (await request(first, "POST", "/accounts", { name: "  " })).statusCode,
    400,
  );
  assert.equal(
    (
      await request(first, "POST", "/accounts", {
        name: "Ana",
        created_by: owner.id,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await request(first, "GET", "/accounts/not-a-uuid")).statusCode,
    400,
  );
});

test("meseros solo cambian existencias mediante consumos y nunca por ajustes directos", async () => {
  const p = await product(80);
  for (const actor of [first, second]) {
    const before = await pool.query("SELECT count(*) FROM stock_moves WHERE product_id=$1", [p.id]);
    for (const [method, route, payload] of [
      ["PATCH", `/products/${p.id}`, { ...p, stock: 100 }],
      ["POST", `/products/${p.id}/stock`, { quantity: 20 }],
      ["POST", "/products", { name: "Sin permiso", photo_id: photo, price: 100, stock: 100 }],
    ] as const) {
      const response = await request(actor, method, route, payload);
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(await stock(p.id), 80);
    }
    const after = await pool.query("SELECT count(*) FROM stock_moves WHERE product_id=$1", [p.id]);
    assert.deepEqual(after.rows, before.rows);
  }
  const a = await customer();
  const result = await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 1, add: [{ product_id: p.id, quantity: 2 }],
  });
  assert.equal(await stock(p.id), 78);
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: result.account.version, set: [{ id: result.account.items[0].id, quantity: 1 }],
  });
  assert.equal(await stock(p.id), 79);
});

test("corrección de consumo aplica exactamente la diferencia; precio y autor quedan guardados", async () => {
  const p = await product(10);
  const a = await customer();
  const registered = await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 1,
    add: [{ product_id: p.id, quantity: 4 }],
  });
  const line = registered.account.items[0];
  assert.equal(await stock(p.id), 6);
  assert.equal(line.recorded_by, first.id);
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 2,
    set: [{ id: line.id, quantity: 2 }],
  });
  assert.equal(await stock(p.id), 8);
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 3,
    set: [{ id: line.id, quantity: 5 }],
  });
  assert.equal(await stock(p.id), 5);
  const current = (await ok(owner, "GET", "/products")).find(
    (x: any) => x.id === p.id,
  );
  await ok(owner, "PATCH", `/products/${p.id}`, {
    name: "Precio nuevo",
    photo_id: photo,
    price: 99900,
    purchase_cost: 50000,
    stock: 5,
    active: true,
    version: current.version,
  });
  assert.equal((await account(a.id)).items[0].unit_price, p.price);
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 4,
    set: [{ id: line.id, quantity: 0 }],
  });
  assert.equal(await stock(p.id), 10);
  assert.equal((await account(a.id)).calculated_total, 0);
});

test("pedido de varios productos es atómico y no deja auditoría ni movimientos parciales", async () => {
  const p = await product(5);
  const empty = await product(0);
  const a = await customer();
  const before = (await pool.query("SELECT count(*) FROM audit")).rows[0].count;
  const response = await request(
    first,
    "POST",
    `/accounts/${a.id}/consumption`,
    {
      version: 1,
      add: [
        { product_id: p.id, quantity: 2 },
        { product_id: empty.id, quantity: 1 },
      ],
    },
  );
  assert.equal(response.statusCode, 409);
  assert.equal(await stock(p.id), 5);
  assert.equal(await stock(empty.id), 0);
  assert.equal((await account(a.id)).items.length, 0);
  assert.equal((await account(a.id)).version, 1);
  assert.equal(
    (await pool.query("SELECT count(*) FROM audit")).rows[0].count,
    before,
  );
});

test("dos meseros con conexiones reales compiten por la última unidad y solo uno gana", async () => {
  const p = await product(1);
  const a = await customer(first);
  const b = await customer(second);
  const responses = await Promise.all([
    request(first, "POST", `/accounts/${a.id}/consumption`, {
      version: 1,
      add: [{ product_id: p.id, quantity: 1 }],
    }),
    request(second, "POST", `/accounts/${b.id}/consumption`, {
      version: 1,
      add: [{ product_id: p.id, quantity: 1 }],
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(await stock(p.id), 0);
  const {
    rows: [totals],
  } = await pool.query(
    "SELECT sum(quantity) AS qty FROM consumption WHERE product_id=$1",
    [p.id],
  );
  assert.equal(totals.qty, 1);
  await assert.rejects(
    pool.query("UPDATE products SET stock=-1 WHERE id=$1", [p.id]),
    /check constraint/,
  );
});

test("operaciones repetidas son idempotentes y dos ediciones detectan versión obsoleta", async () => {
  const p = await product(20);
  const a = await customer();
  const key = randomUUID();
  const input = { version: 1, add: [{ product_id: p.id, quantity: 2 }] };
  const responses = await Promise.all([
    request(first, "POST", `/accounts/${a.id}/consumption`, input, key),
    request(first, "POST", `/accounts/${a.id}/consumption`, input, key),
  ]);
  for (const response of responses)
    assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(responses[0].json(), responses[1].json());
  assert.equal(await stock(p.id), 18);
  assert.equal(
    (
      await request(
        first,
        "POST",
        `/accounts/${a.id}/consumption`,
        { ...input, add: [{ product_id: p.id, quantity: 3 }] },
        key,
      )
    ).statusCode,
    409,
  );
  const line = responses[0].json().account.items[0];
  const edits = await Promise.all([
    request(first, "POST", `/accounts/${a.id}/consumption`, {
      version: 2,
      set: [{ id: line.id, quantity: 4 }],
    }),
    request(first, "POST", `/accounts/${a.id}/consumption`, {
      version: 2,
      set: [{ id: line.id, quantity: 6 }],
    }),
  ]);
  assert.deepEqual(edits.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (await stock(p.id)) + (await account(a.id)).items[0].quantity,
    20,
  );
});

test("mesero ajeno agrega y corrige únicamente sus entregas; dueño y creador administran", async () => {
  const p = await product(20);
  const a = await customer(first);
  let result = await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 1,
    add: [{ product_id: p.id, quantity: 1 }],
  });
  const original = result.account.items[0];
  result = await ok(second, "POST", `/accounts/${a.id}/consumption`, {
    version: 2,
    add: [{ product_id: p.id, quantity: 2 }],
  });
  const own = result.account.items.find(
    (i: any) => i.recorded_by === second.id,
  );
  assert.ok(own);
  assert.equal(
    (
      await request(second, "POST", `/accounts/${a.id}/consumption`, {
        version: 3,
        set: [{ id: original.id, quantity: 0 }],
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(second, "PATCH", `/accounts/${a.id}`, {
        version: 3,
        name: "Prohibido",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(second, "POST", `/accounts/${a.id}/close`, {
        version: 3,
        final_total: null,
        confirmed: true,
      })
    ).statusCode,
    403,
  );
  await ok(second, "POST", `/accounts/${a.id}/consumption`, {
    version: 3,
    set: [{ id: own.id, quantity: 1 }],
  });
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 4,
    set: [{ id: own.id, quantity: 2 }],
  });
  assert.equal(
    (await account(a.id)).items.find((i: any) => i.id === own.id).recorded_by,
    second.id,
  );
  const others = await ok(second, "GET", "/accounts?scope=others");
  assert.ok(
    others.rows.some((x: any) => x.id === a.id && x.creator_name === "ana"),
  );
});

test("consumo personal privado, editable y separado de ventas", async () => {
  const p = await product(8);
  const a = await ok(first, "POST", "/personal");
  const duplicate = await ok(first, "POST", "/personal");
  assert.equal(duplicate.id, a.id);
  const result = await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 1,
    add: [{ product_id: p.id, quantity: 3 }],
  });
  assert.equal(await stock(p.id), 5);
  assert.equal(
    (await request(second, "GET", `/accounts/${a.id}`)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(second, "POST", `/accounts/${a.id}/consumption`, {
        version: 2,
        add: [{ product_id: p.id, quantity: 1 }],
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(first, "POST", `/accounts/${a.id}/close`, {
        version: 2,
        final_total: null,
        confirmed: true,
      })
    ).statusCode,
    409,
  );
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 2,
    set: [{ id: result.account.items[0].id, quantity: 1 }],
  });
  assert.equal(await stock(p.id), 7);
  assert.ok(
    !(await ok(first, "GET", "/accounts")).rows.some((x: any) => x.id === a.id),
  );
  assert.ok(
    (await ok(owner, "GET", "/users")).find((u: any) => u.id === first.id)
      .personal_account_id === a.id,
  );
});

test("consumo del dueño: inventario, privacidad y detalle por intervalo en cierres", async () => {
  const p = await product(12, 125000);
  const a = await ok(owner, "POST", "/personal");
  assert.equal((await ok(owner, "POST", "/personal")).id, a.id);
  let result = await ok(owner, "POST", `/accounts/${a.id}/consumption`, {
    version: a.version, add: [{product_id:p.id,quantity:2}],
  });
  assert.equal(await stock(p.id),10);
  assert.equal((await request(first,"GET",`/accounts/${a.id}`)).statusCode,403);
  assert.equal((await request(first,"POST",`/accounts/${a.id}/consumption`,{
    version:result.account.version,add:[{product_id:p.id,quantity:1}],
  })).statusCode,403);
  const own = await ok(owner,"GET","/accounts?kind=personal&scope=mine");
  assert.equal(own.rows.length,1); assert.equal(own.rows[0].created_by,owner.id);
  const from = (await pool.query("SELECT clock_timestamp() AS t")).rows[0].t.toISOString();
  result = await ok(owner,"POST",`/accounts/${a.id}/consumption`,{
    version:result.account.version,set:[{id:result.account.items[0].id,quantity:1}],
  });
  assert.equal(await stock(p.id),11);
  const other = await ok(second,"POST","/personal");
  await ok(second,"POST",`/accounts/${other.id}/consumption`,{
    version:other.version,add:[{product_id:p.id,quantity:3}],
  });
  const preview = await ok(owner,"POST","/register/preview",{from});
  assert.equal(preview.personal.length,2);
  const ownerEvent = preview.personal.find((e:any)=>e.person_role==="admin");
  assert.equal(ownerEvent.person_name,"dueno");
  assert.equal(ownerEvent.actor_name,"dueno");
  assert.equal(ownerEvent.items[0].quantity,-1);
  assert.equal(ownerEvent.total,-125000);
  assert.equal(preview.personal_total,250000);
  assert.equal(preview.sales.length,0);
  assert.deepEqual(preview.collected,{cash:0,sinpe:0,card:0});
  const closing = await ok(owner,"POST","/register/closings",{
    period:preview.period,fingerprint:preview.fingerprint,opening:0,counts:{},actual_sinpe:null,actual_card:null,
    note:"",supersedes:null,confirmed:true,
  });
  assert.equal(closing.expected_cash,0); assert.equal(closing.difference_cash,0);
  assert.deepEqual(closing.snapshot.personal,preview.personal);
  // A correction belongs to its own interval and never rewrites a saved closing.
  const after = (await pool.query("SELECT clock_timestamp() AS t")).rows[0].t.toISOString();
  await ok(owner,"POST",`/accounts/${a.id}/consumption`,{
    version:result.account.version,set:[{id:result.account.items[0].id,quantity:0}],
  });
  assert.equal(await stock(p.id),9);
  const latest = await ok(owner,"POST","/register/preview",{from:after});
  assert.equal(latest.personal.length,1); assert.equal(latest.personal_total,-125000);
  assert.equal(latest.personal[0].items[0].quantity,-1);
  const saved = await ok(owner,"GET",`/register/closings/${closing.id}`);
  assert.deepEqual(saved.snapshot.personal,preview.personal);
});

test("costos obligatorios, ganancias históricas y privacidad por rol", async () => {
  const base = {name:"Costo validado",photo_id:photo,price:125000,stock:10};
  assert.equal((await request(owner,"POST","/products",base)).statusCode,400);
  for(const purchase_cost of [-1,1.5,1000000001,null])
    assert.equal((await request(owner,"POST","/products",{...base,purchase_cost})).statusCode,400);
  const zero = await ok(owner,"POST","/products",{...base,purchase_cost:0});
  assert.equal(zero.purchase_cost,0);
  const from = (await pool.query("SELECT clock_timestamp() AS t")).rows[0].t.toISOString();
  const p = await product(10);
  const a = await customer(first);
  let detail = (await ok(first,"POST",`/accounts/${a.id}/consumption`,{
    version:1,add:[{product_id:p.id,quantity:2}],
  })).account;
  const line = detail.items[0];
  const current = (await ok(owner,"GET","/products")).find((x:any)=>x.id===p.id);
  await ok(owner,"PATCH",`/products/${p.id}`,{
    name:p.name,photo_id:photo,price:150000,purchase_cost:80000,stock:current.stock,active:true,version:current.version,
  });
  detail = (await ok(first,"POST",`/accounts/${a.id}/consumption`,{
    version:detail.version,add:[{product_id:p.id,quantity:1}],
  })).account;
  detail = (await ok(first,"POST",`/accounts/${a.id}/consumption`,{
    version:detail.version,set:[{id:line.id,quantity:1}],
  })).account;
  assert.equal(await stock(p.id),8);
  const costs = (await pool.query("SELECT unit_cost FROM consumption WHERE account_id=$1 ORDER BY recorded_at,id",[a.id])).rows;
  assert.deepEqual(costs.map(c=>c.unit_cost),[50000,80000]);
  await assert.rejects(pool.query("UPDATE consumption SET unit_cost=1 WHERE id=$1",[line.id]),/costo registrado/);
  detail = await ok(first,"POST",`/accounts/${a.id}/close`,{
    version:detail.version,final_total:240000,cash_received:300000,confirmed:true,
  });
  const report = await ok(owner,"GET","/cash-flow");
  const sale = report.rows.find((s:any)=>s.id===a.id);
  assert.equal(sale.cost,130000);assert.equal(sale.profit,110000);assert.equal(sale.missing_cost_units,0);
  for(const rows of [report.totals,report.daily,report.sellers])
    for(const row of rows) if(row.missing_cost_units===0) assert.equal(row.profit,row.total-row.cost);
  const products = await ok(first,"GET","/products");
  assert.ok(products.every((product:any)=>!("purchase_cost" in product)));
  assert.ok(detail.items.every((item:any)=>!("unit_cost" in item)));
  assert.ok(detail.invoices.every((invoice:any)=>invoice.snapshot.items.every((item:any)=>!("unit_cost" in item))));
  const workerReport = await ok(first,"GET","/sales");
  for(const rows of [workerReport.rows,workerReport.daily,workerReport.sellers,workerReport.totals])
    for(const row of rows) for(const field of ["cost","profit","missing_cost_units"]) assert.ok(!(field in row));
  const preview = await ok(owner,"POST","/register/preview",{from});
  assert.equal(preview.cost,130000);assert.equal(preview.profit,110000);
  const saved = await ok(owner,"POST","/register/closings",{
    period:preview.period,fingerprint:preview.fingerprint,opening:0,counts:{"1000":2,"100":4},
    actual_sinpe:null,actual_card:null,note:"",supersedes:null,confirmed:true,
  });
  assert.equal(saved.expected_cash,240000);assert.equal(saved.snapshot.profit,110000);
  // Later invoice corrections change quantities or final price, never the delivery's unit cost.
  detail = await ok(owner,"PATCH",`/accounts/${a.id}/final`,{version:detail.version,final_total:100000,confirmed:true});
  const corrected = await ok(owner,"GET","/cash-flow");
  assert.equal(corrected.rows.find((s:any)=>s.id===a.id).profit,-30000);
  assert.equal((await ok(owner,"GET",`/register/closings/${saved.id}`)).snapshot.profit,110000);
});

test("costos antiguos quedan pendientes y entregas del servidor anterior capturan el costo actual", async () => {
  const p = await product(10);
  await pool.query("UPDATE products SET purchase_cost=NULL WHERE id=$1",[p.id]);
  const a = await customer(second);
  let detail = (await ok(second,"POST",`/accounts/${a.id}/consumption`,{
    version:1,add:[{product_id:p.id,quantity:1}],
  })).account;
  assert.equal((await pool.query("SELECT unit_cost FROM consumption WHERE account_id=$1",[a.id])).rows[0].unit_cost,null);
  await pool.query("UPDATE products SET purchase_cost=40000 WHERE id=$1",[p.id]);
  // The old server omits the new column. The database still captures it for each new delivery.
  const legacy = (await pool.query(`INSERT INTO consumption(account_id,product_id,product_name,unit_price,quantity,recorded_by)
    VALUES($1,$2,$3,$4,1,$5) RETURNING unit_cost`,[a.id,p.id,p.name,p.price,second.id])).rows[0];
  assert.equal(legacy.unit_cost,40000);
  detail = await ok(second,"POST",`/accounts/${a.id}/close`,{version:detail.version,final_total:250000,cash_received:250000,confirmed:true});
  const report = await ok(owner,"GET","/cash-flow");
  const sale = report.rows.find((s:any)=>s.id===a.id);
  assert.equal(sale.cost,null);assert.equal(sale.profit,null);assert.equal(sale.missing_cost_units,1);
  const seller = report.sellers.find((s:any)=>s.id===second.id);
  assert.equal(seller.profit,null);assert.equal(seller.cost,null);
  const preview = await ok(owner,"POST","/register/preview",{from:detail.paid_at});
  assert.equal(preview.profit,null);assert.equal(preview.missing_cost_units,1);
});

test("cierre validado, doble cierre, cambio de precio y facturas inmutables", async () => {
  const p = await product(10, 125050);
  const a = await customer();
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 1,
    add: [{ product_id: p.id, quantity: 2 }],
  });
  for (const value of [-1, 1.5, "100"])
    assert.equal(
      (
        await request(first, "POST", `/accounts/${a.id}/close`, {
          version: 2,
          final_total: value,
          confirmed: true,
        })
      ).statusCode,
      400,
    );
  const responses = await Promise.all([
    request(first, "POST", `/accounts/${a.id}/close`, {
      version: 2,
      final_total: 200000,
      confirmed: true,
    }),
    request(first, "POST", `/accounts/${a.id}/close`, {
      version: 2,
      final_total: 200000,
      confirmed: true,
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 403]);
  let current = await account(a.id);
  assert.equal(current.calculated_total, 250100);
  assert.equal(current.final_total, 200000);
  assert.equal(current.adjusted_by, first.id);
  assert.ok(current.closed_at);
  assert.equal(current.invoices.length, 1);
  const original = current.invoices[0].snapshot;
  assert.equal(
    (
      await request(first, "POST", `/accounts/${a.id}/consumption`, {
        version: current.version,
        set: [{ id: current.items[0].id, quantity: 1 }],
      })
    ).statusCode,
    403,
  );
  await ok(owner, "POST", `/accounts/${a.id}/consumption`, {
    version: current.version,
    set: [{ id: current.items[0].id, quantity: 1 }],
  });
  current = await account(a.id);
  assert.equal(current.calculated_total, 125050);
  assert.equal(current.final_total, 200000);
  assert.equal(current.invoices.length, 2);
  assert.deepEqual(current.invoices[1].snapshot, original);
  assert.equal(await stock(p.id), 9);
  await ok(owner, "PATCH", `/accounts/${a.id}/final`, {
    version: current.version,
    final_total: 123400,
    confirmed: true,
  });
  current = await account(a.id);
  assert.equal(current.final_total, 123400);
  assert.equal(current.invoices.length, 3);
  assert.equal(current.adjusted_by, owner.id);
  await assert.rejects(
    pool.query("UPDATE invoices SET revision=8 WHERE account_id=$1", [a.id]),
    /inmutable/,
  );
  await assert.rejects(
    pool.query("DELETE FROM audit WHERE entity_id=$1", [a.id]),
    /inmutable/,
  );
});

test("ajuste manual simultáneo con venta nunca pierde unidades y desactivar conserva historial", async () => {
  const p = await product(5);
  const a = await customer();
  const responses = await Promise.all([
    request(owner, "PATCH", `/products/${p.id}`, {
      name: p.name,
      photo_id: photo,
      price: p.price,
      purchase_cost: p.purchase_cost,
      stock: 7,
      active: true,
      version: p.version,
    }),
    request(first, "POST", `/accounts/${a.id}/consumption`, {
      version: 1,
      add: [{ product_id: p.id, quantity: 1 }],
    }),
  ]);
  assert.equal(responses[1].statusCode, 200, responses[1].body);
  assert.equal(await stock(p.id), responses[0].statusCode === 200 ? 6 : 4);
  const current = (await ok(owner, "GET", "/products")).find(
    (x: any) => x.id === p.id,
  );
  await ok(owner, "PATCH", `/products/${p.id}`, {
    name: p.name,
    photo_id: photo,
    price: p.price,
    purchase_cost: p.purchase_cost,
    stock: current.stock,
    active: false,
    version: current.version,
  });
  assert.ok(
    !(await ok(first, "GET", "/products")).some((x: any) => x.id === p.id),
  );
  assert.equal(
    (
      await request(first, "POST", `/accounts/${a.id}/consumption`, {
        version: 2,
        add: [{ product_id: p.id, quantity: 1 }],
      })
    ).statusCode,
    409,
  );
  const existing = await account(a.id);
  assert.equal(existing.items[0].product_id, p.id);
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 2,
    set: [{ id: existing.items[0].id, quantity: 0 }],
  });
  assert.equal(await stock(p.id), current.stock + 1);
});

test("dos pantallas reciben SSE después del commit y revocación cierra el acceso", async () => {
  const abort = new AbortController();
  const responses = await Promise.all(
    [owner, second].map((u) =>
      fetch(`${serverUrl}/api/events`, {
        headers: { cookie: u.cookie },
        signal: abort.signal,
      }),
    ),
  );
  const readers = responses.map((r) => r.body!.getReader());
  for (const reader of readers)
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: change/,
    );
  await product(15);
  for (const reader of readers) {
    const read = reader.read();
    const value = await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("No llegó el evento")),
          3000,
        );
        timer.unref();
      }),
    ]);
    assert.match(new TextDecoder().decode(value.value), /event: change/);
  }
  abort.abort();
  for (const reader of readers) await reader.cancel().catch(() => {});
});

test("perfiles sin contraseña, cambio de rol y eliminación conservan las referencias", async () => {
  const worker = await ok(owner, "POST", "/users", { username: "temporal", name: "Temporal" });
  const original = await login("temporal");
  const a = await customer(original);
  const switched = await app.inject({ method: "POST", url: "/api/entry", headers: { origin: config.origin, cookie: original.cookie }, payload: { role: "admin" } });
  assert.equal(switched.statusCode, 200);
  assert.equal(switched.json().user.role, "admin");
  assert.equal((await request(original, "GET", "/me")).statusCode, 401);
  const next = await login("temporal");
  await ok(owner, "DELETE", `/users/${worker.id}`);
  assert.equal((await request(next, "GET", "/me")).statusCode, 401);
  assert.equal((await account(a.id)).created_by, worker.id);
  const invalid = await app.inject({ method: "POST", url: "/api/entry", headers: { origin: config.origin }, payload: { role: "waiter", username: "dueno" } });
  assert.equal(invalid.statusCode, 404);
});

test("fotos se validan por contenido y se conservan como imágenes limpias", async () => {
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#c8daae" },
  })
    .png()
    .toBuffer();
  const upload = async (data: Buffer, actor: Login) => {
    const form = new FormData();
    form.append(
      "photo",
      new Blob([new Uint8Array(data)], { type: "image/png" }),
      "foto.png",
    );
    return fetch(`${serverUrl}/api/photos`, {
      method: "POST",
      headers: {
        origin: config.origin,
        cookie: actor.cookie,
        "x-csrf-token": actor.csrf,
      },
      body: form,
    });
  };
  const result = await upload(image, owner);
  assert.equal(result.status, 200, await result.clone().text());
  const id = ((await result.json()) as { id: string }).id;
  const downloaded = await request(first, "GET", `/photos/${id}`);
  assert.equal(downloaded.headers["content-type"], "image/webp");
  assert.equal((await sharp(downloaded.rawPayload).metadata()).format, "webp");
  assert.equal(
    (await upload(Buffer.from("<script>alert(1)</script>"), owner)).status,
    400,
  );
  assert.equal((await upload(image, first)).status, 403);
});

test("importes decimales se convierten sin redondeos binarios", () => {
  assert.equal(parseMoney("1250.50"), 125050);
  assert.equal(parseMoney("0.01"), 1);
  assert.equal(parseMoney("0"), 0);
  assert.equal(parseMoney("12,99"), 1299);
  for (const invalid of ["-1", "1.999", "1e5", "Infinity", "", "0x10"])
    assert.throws(() => parseMoney(invalid));
});

test("auditoría paginada conserva orden cronológico aunque difiera el orden de los IDs", async () => {
  const {
    rows: [recent],
  } = await pool.query(
    "INSERT INTO audit(actor_id,action,created_at) VALUES($1,'Fecha reciente',now()+interval '1 minute') RETURNING id",
    [owner.id],
  );
  await pool.query(
    "INSERT INTO audit(actor_id,action,created_at) VALUES($1,'Fecha anterior',now()-interval '1 day')",
    [owner.id],
  );
  const page = await ok(owner, "GET", "/audit");
  assert.equal(page.rows[0].id, recent.id);
  assert.ok(
    page.rows.every(
      (row: any, i: number) =>
        !i || new Date(page.rows[i - 1].created_at) >= new Date(row.created_at),
    ),
  );
  const next = await ok(owner, "GET", `/audit?before=${page.rows.at(-1).id}`);
  assert.ok(
    next.rows.every(
      (row: any) => !page.rows.some((old: any) => old.id === row.id),
    ),
  );
  if (next.rows.length)
    assert.ok(
      new Date(page.rows.at(-1).created_at) >=
        new Date(next.rows[0].created_at),
    );
});

test("efectivo, vuelto y reportes respetan fechas CR, vendedor, permisos e historial", async () => {
  const p = await product(20, 100000);
  const a = await customer(first);
  await ok(first, "POST", `/accounts/${a.id}/consumption`, {
    version: 1,
    add: [{ product_id: p.id, quantity: 1 }],
  });
  await ok(second, "POST", `/accounts/${a.id}/consumption`, {
    version: 2,
    add: [{ product_id: p.id, quantity: 2 }],
  });
  const before = await account(a.id);
  for (const cash_received of [99999, -1, 1.5, 9000000000001]) {
    const rejected = await request(first, "POST", `/accounts/${a.id}/close`, {
      version: 3,
      final_total: 100000,
      cash_received,
      confirmed: true,
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
  }
  assert.equal((await account(a.id)).closed_at, null);
  assert.equal((await account(a.id)).version, before.version);
  assert.equal(await stock(p.id), 17);
  const key = randomUUID();
  const payload = {
    version: 3,
    final_total: 100000,
    cash_received: 500000,
    confirmed: true,
  };
  const paid = await request(
    first,
    "POST",
    `/accounts/${a.id}/close`,
    payload,
    key,
  );
  assert.equal(paid.statusCode, 200, paid.body);
  assert.equal(
    (await request(first, "POST", `/accounts/${a.id}/close`, payload, key))
      .statusCode,
    200,
  );
  let result = await account(a.id);
  assert.equal(result.cash_received, 500000);
  assert.equal(result.cash_change, 400000);
  assert.equal(result.invoices[0].snapshot.cash_change, 400000);
  assert.equal(await stock(p.id), 17);
  result = await ok(owner, "PATCH", `/accounts/${a.id}`, {
    version: result.version,
    name: a.name,
    arrived_at: "2026-09-20T05:30:00Z",
    closed_at: "2026-09-21T05:59:59Z",
  });
  result = await ok(owner, "PATCH", `/accounts/${a.id}/final`, {
    version: result.version,
    final_total: 120000,
    confirmed: true,
  });
  assert.equal(result.cash_change, 400000); // A later correction does not invent a new cash payment.
  const other = await customer(second);
  const closedOther = await ok(second, "POST", `/accounts/${other.id}/close`, {
    version: 1,
    final_total: 50000,
    cash_received: 50000,
    confirmed: true,
  });
  await ok(owner, "PATCH", `/accounts/${other.id}`, {
    version: closedOther.version,
    name: other.name,
    arrived_at: "2026-09-20T06:00:00Z",
    closed_at: "2026-09-21T06:00:00Z",
  });
  const query = `from=2026-09-20&to=2026-09-20&seller=${first.id}`;
  const report = await ok(owner, "GET", `/cash-flow?${query}`);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].id, a.id);
  assert.equal(report.totals[0].accounts, 1); // Three invoice revisions still represent one sale.
  assert.equal(report.totals[0].total, 120000);
  assert.equal(report.totals[0].received, 500000);
  assert.equal(report.totals[0].change, 400000);
  assert.equal(report.totals[0].cash_net, 100000);
  assert.equal(report.daily[0].day, "2026-09-20");
  assert.equal(report.sellers[0].id, first.id); // Both waiters served; the collector owns this sale.
  assert.equal(
    (await ok(second, "GET", "/sales?from=2026-09-20&to=2026-09-20")).rows
      .length,
    0,
  );
  assert.equal(
    (await request(second, "GET", `/sales?seller=${first.id}`)).statusCode,
    403,
  );
  assert.equal((await request(first, "GET", "/cash-flow")).statusCode, 403);
  assert.equal((await request(first, "GET", "/movements")).statusCode, 403);
  assert.equal(
    (await request(owner, "GET", "/sales?from=2026-09-21&to=2026-09-20"))
      .statusCode,
    400,
  );
  assert.equal(
    (await request(owner, "GET", "/sales?from=2026-02-30")).statusCode,
    400,
  );
  const ownReport = await ok(first, "GET", `/sales?${query}`);
  assert.equal(ownReport.rows.length, 1);
  assert.equal((await ok(first, "GET", "/report-sellers")).length, 1);
  const directory = await app.inject({ url: "/api/sellers" });
  assert.equal(directory.statusCode, 200);
  assert.ok(directory.json().some((user: any) => user.username === "ana"));
  assert.ok(
    directory
      .json()
      .every(
        (user: any) => Object.keys(user).sort().join(",") === "name,username",
      ),
  );
  assert.ok(!directory.json().some((user: any) => user.username === "dueno"));
  const movements = await ok(owner, "GET", `/movements?seller=${second.id}`);
  assert.ok(
    movements.rows.some(
      (row: any) => row.account_id === a.id && row.delta === -2,
    ),
  );
  assert.ok(movements.rows.every((row: any) => row.actor_id === second.id));
  const audit = await ok(owner, "GET", `/audit?seller=${first.id}`);
  assert.ok(audit.rows.every((row: any) => row.actor_id === first.id));
  await pool.query(
    "UPDATE accounts SET cash_received=NULL,cash_change=NULL WHERE id=$1",
    [a.id],
  );
  const legacy = await ok(owner, "GET", `/cash-flow?${query}`);
  assert.equal(legacy.totals[0].unrecorded, 1);
  assert.equal(legacy.totals[0].cash_net, 0);
  assert.equal(legacy.totals[0].total, 120000);
});

test("entradas de inventario suman sin perder ventas concurrentes y protegen el rol", async () => {
  const p = await product(100);
  const c = await customer();
  const key = randomUUID();
  const added = await request(owner, "POST", `/products/${p.id}/stock`, { quantity: 30 }, key);
  assert.equal(added.statusCode, 200, added.body);
  assert.equal(added.json().stock, 130);
  const repeated = await request(owner, "POST", `/products/${p.id}/stock`, { quantity: 30 }, key);
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(await stock(p.id), 130);
  const results = await Promise.all([
    request(owner, "POST", `/products/${p.id}/stock`, { quantity: 20 }),
    request(owner, "POST", `/products/${p.id}/stock`, { quantity: 10 }),
    request(first, "POST", `/accounts/${c.id}/consumption`, { version: 1, add: [{ product_id: p.id, quantity: 1 }] }),
  ]);
  for (const result of results) assert.equal(result.statusCode, 200, result.body);
  assert.equal(await stock(p.id), 159);
  assert.equal((await request(first, "POST", `/products/${p.id}/stock`, { quantity: 10 })).statusCode, 403);
  for (const quantity of [0, -1, 1.5, 1000001]) {
    assert.equal((await request(owner, "POST", `/products/${p.id}/stock`, { quantity })).statusCode, 400);
  }
  assert.equal((await request(owner, "POST", `/products/${p.id}/stock`, { quantity: 1000000 })).statusCode, 400);
  assert.equal(await stock(p.id), 159);
  const moves = (await pool.query("SELECT * FROM stock_moves WHERE product_id=$1 AND reason='Entrada de inventario' ORDER BY id", [p.id])).rows;
  assert.equal(moves.length, 3);
  assert.equal(moves.reduce((sum, row) => sum + row.delta, 0), 60);
  for (const move of moves) {
    assert.equal(move.stock_after - move.stock_before, move.delta);
    assert.equal(move.actor_id, owner.id);
  }
  const logs = (await pool.query("SELECT * FROM audit WHERE entity_id=$1 AND action='Existencias añadidas'", [p.id])).rows;
  assert.equal(logs.length, 3);
});

test("cierre de caja: pagos mixtos, conteo, movimientos, permisos e historia inmutable", async () => {
  const from = (await pool.query("SELECT clock_timestamp() AS t")).rows[0].t.toISOString();
  const a = await customer(first);
  const invalid = await request(first, "POST", `/accounts/${a.id}/close`, {
    version: 1, final_total: 10000000, confirmed: true, cash_received: 1000000,
    payments: {cash: 1000000,sinpe: 8000000,card: 0},
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await account(a.id)).closed_at, null);
  let paid = await ok(first, "POST", `/accounts/${a.id}/close`, {
    version: 1, final_total: 10000000, confirmed: true, cash_received: 2000000,
    payments: {cash: 1000000,sinpe: 8000000,card: 1000000},
  });
  assert.equal(paid.cash_change, 1000000);
  assert.equal(paid.invoices[0].snapshot.payment_sinpe, 8000000);
  for (const [method,path,payload] of [
    ["GET","/register/settings",undefined], ["PUT","/register/settings",{day_start:"06:00",opening_default:0}],
    ["POST","/register/preview",{from}], ["GET","/register/closings",undefined],
    ["POST","/register/closings",{}], ["POST","/register/entries",{}],
    ["POST",`/register/entries/${randomUUID()}/reverse`,{}],
    ["PATCH",`/accounts/${a.id}/payments`,{}],
  ] as const) assert.equal((await request(first,method,path,payload)).statusCode,403,path);
  const settings = await ok(owner,"GET","/register/settings");
  assert.equal(settings.day_start,"00:00");
  assert.equal(settings.opening_default,null);
  await ok(owner,"PUT","/register/settings",{day_start:"05:00",opening_default:500000});
  assert.equal((await ok(owner,"GET","/register/settings")).day_start,"05:00");
  await ok(owner,"PUT","/register/settings",{day_start:"00:00",opening_default:null});
  const out = await ok(owner,"POST","/register/entries",{
    method:"cash",direction:"out",amount:200000,occurred_at:new Date().toISOString(),reason:"Compra de hielo",
  });
  const preview = await ok(owner,"POST","/register/preview",{from});
  assert.equal(preview.sales.length,1);
  assert.deepEqual(preview.collected,{cash:1000000,sinpe:8000000,card:1000000});
  assert.equal(preview.movements.cash,-200000);
  assert.equal(preview.sellers[0].name,paid.creator_name);
  const payload = {period:preview.period,fingerprint:preview.fingerprint,opening:500000,
    counts:{"1000":10,"500":6},actual_sinpe:null,actual_card:null,note:"",supersedes:null,confirmed:true};
  const key = randomUUID();
  const save = await request(owner,"POST","/register/closings",payload,key);
  assert.equal(save.statusCode,200,save.body);
  const closing = save.json();
  assert.equal(closing.expected_cash,1300000);
  assert.equal(closing.actual_cash,1300000);
  assert.equal(closing.difference_cash,0);
  assert.equal(closing.actual_card,null);
  assert.equal((await request(owner,"POST","/register/closings",payload,key)).json().id,closing.id);
  assert.equal((await request(first,"GET",`/register/closings/${closing.id}`)).statusCode,403);
  await assert.rejects(pool.query("UPDATE cash_closings SET note='edited' WHERE id=$1",[closing.id]));
  await assert.rejects(pool.query("DELETE FROM cash_entries WHERE id=$1",[out.id]));
  // A price correction changes billing, never the historical money actually collected.
  paid = await ok(owner,"PATCH",`/accounts/${a.id}/final`,{version:paid.version,final_total:11000000,confirmed:true});
  assert.equal(paid.payment_cash,1000000);
  assert.equal((await request(owner,"POST","/register/closings",payload)).statusCode,409);
  const corrected = await ok(owner,"PATCH",`/accounts/${a.id}/payments`,{
    version:paid.version,payments:{cash:1500000,sinpe:7500000,card:1000000},cash_received:2000000,reason:"Comprobante SINPE revisado",
  });
  assert.equal(corrected.cash_change,500000);
  assert.equal(corrected.paid_at,paid.paid_at);
  const reversal = await ok(owner,"POST",`/register/entries/${out.id}/reverse`,{reason:"Gasto registrado en otra caja"});
  assert.equal(reversal.direction,"in");
  assert.equal((await request(owner,"POST",`/register/entries/${out.id}/reverse`,{reason:"No duplicar"})).statusCode,409);
  const latest = await ok(owner,"POST","/register/preview",preview.period);
  assert.equal(latest.total,11000000);
  assert.equal(latest.collected.cash,1500000);
  assert.equal(latest.movements.cash,0);
  const revised = {...payload,fingerprint:latest.fingerprint,supersedes:closing.id};
  assert.equal((await request(owner,"POST","/register/closings",revised)).statusCode,400); // explanation required
  const secondClosing = await ok(owner,"POST","/register/closings",{...revised,note:"Faltante pendiente de investigar"});
  assert.equal(secondClosing.difference_cash,-700000);
  assert.equal(secondClosing.supersedes,closing.id);
  const preserved = await ok(owner,"GET",`/register/closings/${closing.id}`);
  assert.deepEqual(preserved.snapshot,closing.snapshot);
  assert.equal(preserved.snapshot.total,10000000);
  assert.equal(preserved.snapshot.entries.length,1);
  assert.equal(preserved.count["500"],6);
  assert.equal((await request(owner,"POST","/register/closings",{...revised,counts:{"500":-1},note:"Invalid"})).statusCode,400);
  assert.equal((await request(owner,"POST","/register/closings",{...revised,counts:{"123":1},note:"Invalid"})).statusCode,400);
  assert.equal((await request(owner,"POST","/register/preview",{from:"2026-02-30T00:00"})).statusCode,400);
  assert.equal((await request(owner,"POST","/register/preview",{from:new Date(Date.now()+10000).toISOString()})).statusCode,400);
  assert.ok((await ok(owner,"GET","/register/closings")).rows.some((r:any)=>r.id===closing.id));
});

test("corte de caja con cobro simultáneo conserva un límite coherente y los pagos sin clasificar", async () => {
  const from = (await pool.query("SELECT clock_timestamp() AS t")).rows[0].t.toISOString();
  const a = await customer(first);
  const [sale, response] = await Promise.all([
    request(first,"POST",`/accounts/${a.id}/close`,{version:1,final_total:100000,confirmed:true,payments:{cash:0,sinpe:100000,card:0}}),
    request(owner,"POST","/register/preview",{from}),
  ]);
  assert.equal(sale.statusCode,200,sale.body); assert.equal(response.statusCode,200,response.body);
  const paid = sale.json(); const review = response.json();
  const included = review.sales.some((s:any)=>s.id===a.id);
  assert.equal(included,new Date(paid.paid_at)<new Date(review.period.to));
  assert.equal(review.collected.sinpe,included ? 100000 : 0);
  // Simulate an account predating cash tracking. No invented cash total.
  await pool.query("UPDATE accounts SET payment_cash=NULL,payment_sinpe=NULL,payment_card=NULL,cash_received=NULL,cash_change=NULL WHERE id=$1",[a.id]);
  const legacy = await ok(owner,"POST","/register/preview",{from});
  assert.equal(legacy.unclassified,1);assert.equal(legacy.collected.cash,0);
  const payload = {period:legacy.period,fingerprint:legacy.fingerprint,opening:0,counts:{},actual_sinpe:null,actual_card:null,note:"",supersedes:null,confirmed:true};
  assert.equal((await request(owner,"POST","/register/closings",payload)).statusCode,400);
  const saved = await ok(owner,"POST","/register/closings",{...payload,note:"Revisar comprobante antiguo"});
  assert.equal(saved.snapshot.unclassified,1);
});

test("despliegue gradual conserva cobros hechos por el servidor anterior", async () => {
  const a = await customer(first);
  // Simulate the previous server's SQL, which does not know the new payment columns.
  await pool.query(`UPDATE accounts SET closed_at=clock_timestamp(),closed_by=$2,final_total=100000,
    cash_received=500000,cash_change=400000 WHERE id=$1`, [a.id,first.id]);
  const row = await account(a.id);
  assert.ok(row.paid_at);
  assert.equal(row.payment_cash,100000);
  assert.equal(row.payment_sinpe,0);
  assert.equal(row.payment_card,0);
});

test("permiso delegado: cierres propios, historial del dueño, revocación y pagos automáticos", async () => {
  const path = `/users/${first.id}/register-permission`;
  assert.equal((await request(first,"PATCH",path,{can_close_register:true})).statusCode,403);
  assert.equal((await request(owner,"PATCH",path,{can_close_register:"true"})).statusCode,400);
  assert.equal((await request(owner,"PATCH",`/users/${owner.id}/register-permission`,{can_close_register:true})).statusCode,404);
  for(const actor of [first,second]) {
    await ok(owner,"PATCH",`/users/${actor.id}/register-permission`,{can_close_register:true});
    assert.equal((await ok(actor,"GET","/me")).user.can_close_register,true);
  }
  const from = (await pool.query("SELECT clock_timestamp() AS t")).rows[0].t.toISOString();
  const p=await product(4), a=await customer(first);
  const consumed=await ok(first,"POST",`/accounts/${a.id}/consumption`,{version:1,add:[{product_id:p.id,quantity:1}]});
  await ok(first,"POST",`/accounts/${a.id}/close`,{version:consumed.account.version,final_total:100000,confirmed:true,cash_received:20000,
    payments:{cash:20000,sinpe:30000,card:50000}});
  await ok(owner,"POST","/register/entries",{method:"sinpe",direction:"in",amount:5000,occurred_at:new Date().toISOString(),reason:"Aporte electrónico"});
  await ok(owner,"POST","/register/entries",{method:"card",direction:"out",amount:5000,occurred_at:new Date().toISOString(),reason:"Devolución con tarjeta"});
  const preview=await ok(owner,"POST","/register/preview",{from});
  const payload={period:preview.period,fingerprint:preview.fingerprint,opening:10000,counts:{"100":3},note:"",supersedes:null,confirmed:true};
  for(const field of ["actual_sinpe","actual_card"]) {
    assert.equal((await request(owner,"POST","/register/closings",{...payload,[field]:999})).statusCode,400);
  }
  const ownerClosing=await ok(owner,"POST","/register/closings",payload);
  const staffPreview=await ok(first,"POST","/register/preview",preview.period);
  assert.equal(staffPreview.fingerprint,preview.fingerprint);
  assert.ok(!("cost" in staffPreview));assert.ok(!("profit" in staffPreview));assert.deepEqual(staffPreview.events,[]);
  assert.deepEqual(staffPreview.personal,[]);assert.ok(staffPreview.sales.every((sale:any)=>!("cost" in sale)));
  assert.equal((await request(first,"PUT","/register/settings",{day_start:"00:00",opening_default:0})).statusCode,403);
  assert.equal((await request(first,"POST","/register/entries",{})).statusCode,403);
  assert.equal((await request(first,"POST",`/register/entries/${randomUUID()}/reverse`,{})).statusCode,403);
  assert.equal((await request(first,"GET",`/register/closings/${ownerClosing.id}`)).statusCode,404);
  assert.equal((await request(first,"POST","/register/closings",{...payload,supersedes:ownerClosing.id})).statusCode,403);
  const key=randomUUID();
  const response=await request(first,"POST","/register/closings",payload,key);
  assert.equal(response.statusCode,200,response.body);
  const saved=response.json();
  assert.equal(saved.actor_id,first.id);assert.equal(saved.actor_name,"ana");
  assert.equal(saved.actual_sinpe,null);assert.equal(saved.actual_card,null);
  assert.equal(saved.total,110000);assert.equal(saved.charged_total,110000);assert.equal(saved.difference_cash,0);
  assert.equal(saved.snapshot.collected.sinpe,30000);assert.equal(saved.snapshot.movements.sinpe,5000);
  assert.ok(!("profit" in saved.snapshot));
  const ownHistory=await ok(first,"GET","/register/closings");
  assert.equal(ownHistory.rows.length,1);assert.equal(ownHistory.rows[0].id,saved.id);
  assert.equal((await ok(second,"GET","/register/closings")).rows.length,0);
  assert.equal((await request(second,"GET",`/register/closings/${saved.id}`)).statusCode,404);
  const ownerView=await ok(owner,"GET",`/register/closings/${saved.id}`);
  assert.equal(ownerView.snapshot.profit,50000);assert.equal(ownerView.actor_name,"ana");
  assert.ok((await ok(owner,"GET","/register/closings")).rows.some((r:any)=>r.id===saved.id&&r.actor_id===first.id));
  const revision=await ok(first,"POST","/register/closings",{...payload,supersedes:saved.id});
  assert.equal(revision.supersedes,saved.id);
  await ok(owner,"PATCH",path,{can_close_register:false});
  assert.equal((await ok(first,"GET","/me")).user.can_close_register,false);
  for(const [method,url,body] of [["GET","/register/settings",undefined],["GET","/register/closings",undefined],
    ["GET",`/register/closings/${saved.id}`,undefined],["POST","/register/preview",{from}],["POST","/register/closings",payload]] as const)
    assert.equal((await request(first,method,url,body)).statusCode,403);
  assert.equal((await request(first,"POST","/register/closings",payload,key)).statusCode,403);
  assert.equal((await ok(owner,"GET",`/register/closings/${saved.id}`)).actor_name,"ana");
  const audit=(await ok(owner,"GET",`/audit?seller=${owner.id}`)).rows;
  assert.ok(audit.some((event:any)=>event.action==="Permiso de cierre de caja cambiado"));
  await ok(owner,"PATCH",`/users/${second.id}/register-permission`,{can_close_register:false});
});

test("datos, fotos y sesiones sobreviven al reinicio de la API", async () => {
  const before = await ok(owner, "GET", "/accounts?status=all");
  assert.ok(before.rows.length > 0);
  await app.close();
  const restarted = await buildApp({ logging: false, events: false });
  try {
    const accounts = await restarted.inject({
      url: "/api/accounts?status=all",
      headers: { cookie: owner.cookie },
    });
    assert.equal(accounts.statusCode, 200);
    assert.deepEqual(accounts.json(), before);
    const image = await restarted.inject({
      url: `/api/photos/${photo}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(image.statusCode, 200);
    assert.equal((await sharp(image.rawPayload).metadata()).format, "webp");
  } finally {
    await restarted.close();
  }
});
