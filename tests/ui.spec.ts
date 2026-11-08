import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

async function login(page: Page, username: string) {
  await page.goto("/");
  if (username !== "dueno") await page.getByRole("combobox", { name: "Perfil de mesero" }).selectOption(username);
  await page.getByRole("button", { name: username === "dueno" ? "Dueño" : "Mesero", exact: true }).click();
  await expect(page.getByText("En tiempo real", { exact: true })).toBeVisible();
}
async function closeModal(page: Page) {
  await page
    .getByRole("button", { name: "Cerrar ventana", exact: true })
    .click();
}
async function card(page: Page, name: string, action: string) {
  await page
    .locator(".customer-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: action, exact: true })
    .click();
}

test("servicio completo con tres sesiones y factura móvil", async ({
  browser,
}) => {
  await mkdir("test-artifacts/screenshots", { recursive: true });
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const anaContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const leoContext = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });
  const owner = await adminContext.newPage(),
    ana = await anaContext.newPage(),
    leo = await leoContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, ana, leo])
    page.on("pageerror", (e) => errors.push(e.message));
  try {
    await owner.goto("/");
    await owner.screenshot({
      path: "test-artifacts/screenshots/01-login-escritorio.png",
      fullPage: true,
    });
    await login(owner, "dueno");
    await login(ana, "ana");
    await login(leo, "leo");
    for (const waiter of [ana, leo]) {
      for (const name of ["Inventario", "Sumar existencias", "Nuevo producto"])
        await expect(waiter.getByRole("button", { name, exact: true })).toHaveCount(0);
      await expect(waiter.getByRole("textbox", { name: "Buscar en inventario", exact: true })).toHaveCount(0);
    }
    await expect(
      owner.getByRole("heading", { name: "Camila Rojas", exact: true }),
    ).toBeVisible();
    await owner.screenshot({
      path: "test-artifacts/screenshots/02-panel-dueno.png",
      fullPage: true,
    });
    await ana.screenshot({
      path: "test-artifacts/screenshots/03-mesero-movil.png",
      fullPage: true,
    });
    await owner
      .getByRole("button", { name: "Inventario", exact: true })
      .click();
    const beer = owner.locator(".inventory-row").filter({
      has: owner.getByRole("heading", {
        name: "Cerveza artesanal",
        exact: true,
      }),
    });
    await expect(beer).toBeVisible();
    const beforeRestock = Number((await beer.locator(".stock-count").innerText()).match(/\d+/)![0]);
    await owner.getByRole("button", { name: "Sumar existencias", exact: true }).click();
    await owner.getByRole("combobox", { name: "Producto", exact: true }).selectOption({ label: "Cerveza artesanal" }, { timeout: 8000 });
    await owner.getByLabel("Cantidad a sumar", { exact: true }).fill("30");
    await expect(owner.locator(".modal .info-box")).toContainText(String(beforeRestock + 30));
    await owner.getByRole("button", { name: "Sumar unidades", exact: true }).click();
    await expect(owner.locator(".modal")).toHaveCount(0);
    await expect(beer.locator(".stock-count")).toContainText(String(beforeRestock + 30));
    const initialStock = Number(
      (await beer.locator(".stock-count").innerText()).match(/\d+/)![0],
    );
    await ana
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    await ana
      .getByLabel("Nombre del cliente", { exact: true })
      .fill("Lucía Fernández");
    await ana.getByRole("button", { name: "Abrir cuenta" }).click();
    await expect(
      ana
        .getByRole("dialog")
        .getByRole("heading", { name: "Lucía Fernández", exact: true }),
    ).toBeVisible();
    await ana
      .getByLabel("Cantidad de Cerveza artesanal", { exact: true })
      .fill("4");
    await ana.getByLabel("Cantidad de Agua mineral", { exact: true }).fill("2");
    await ana.screenshot({
      path: "test-artifacts/screenshots/04-catalogo-movil.png",
      fullPage: true,
    });
    await ana
      .getByRole("button", { name: "Registrar pedido", exact: true })
      .click();
    await expect(
      ana.getByText("Productos registrados", { exact: true }),
    ).toBeVisible();
    await expect(beer.locator(".stock-count")).toHaveText(
      new RegExp(`^${initialStock - 4}\\s`),
    );
    await expect(ana.getByRole("dialog")).toBeHidden();
    await card(ana, "Lucía Fernández", "Ver consumo");
    await ana.getByRole("tab", { name: /^Consumo/ }).click();
    await ana
      .getByLabel("Cantidad registrada de Cerveza artesanal por Ana Torres", {
        exact: true,
      })
      .fill("2");
    await ana
      .getByRole("button", { name: "Guardar corrección", exact: true })
      .click();
    await expect(
      ana.getByText("Consumo corregido e inventario actualizado", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(beer.locator(".stock-count")).toHaveText(
      new RegExp(`^${initialStock - 2}\\s`),
    );
    await closeModal(ana);

    await leo
      .getByRole("button", { name: "Otros meseros", exact: true })
      .click();
    await expect(
      leo.getByRole("heading", { name: "Lucía Fernández", exact: true }),
    ).toBeVisible();
    await leo
      .locator(".customer-card")
      .filter({
        has: leo.getByRole("heading", { name: "Lucía Fernández", exact: true }),
      })
      .locator(".customer-open")
      .click();
    await leo.getByLabel("Cantidad de Vino tinto", { exact: true }).fill("1");
    await leo
      .getByRole("button", { name: "Registrar pedido", exact: true })
      .click();
    await expect(
      leo.getByText("Productos registrados", { exact: true }),
    ).toBeVisible();
    await expect(leo.getByRole("dialog")).toBeHidden();
    await leo
      .locator(".customer-card")
      .filter({
        has: leo.getByRole("heading", { name: "Lucía Fernández", exact: true }),
      })
      .locator(".customer-open")
      .click();
    await leo.getByRole("tab", { name: /^Consumo/ }).click();
    await expect(
      leo.getByLabel("Cantidad registrada de Vino tinto por Leo Vega", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      leo.getByLabel(
        "Cantidad registrada de Cerveza artesanal por Ana Torres",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      leo.getByRole("tab", { name: "Finalizar cuenta", exact: true }),
    ).toHaveCount(0);
    await closeModal(leo);
    await leo.getByRole("button", { name: "Mi consumo", exact: true }).click();
    await leo
      .getByRole("button", { name: "Registrar mi consumo", exact: true })
      .click();
    await leo.getByLabel("Cantidad de Agua mineral", { exact: true }).fill("1");
    await leo
      .getByRole("button", { name: "Registrar pedido", exact: true })
      .click();
    await expect(
      leo.getByText("Productos registrados", { exact: true }),
    ).toBeVisible();
    await expect(leo.getByRole("dialog")).toBeHidden();

    await card(ana, "Lucía Fernández", "Finalizar");
    await ana.getByLabel("Sí, indicar otro importe", { exact: true }).check();
    await ana.getByLabel("Total final (CRC)", { exact: true }).fill("11000");
    await ana
      .getByLabel("Efectivo recibido (CRC)", { exact: true })
      .fill("10000");
    await ana
      .getByRole("button", { name: "Revisar cierre", exact: true })
      .click();
    await expect(
      ana.getByText("El efectivo recibido no alcanza para pagar la cuenta", {
        exact: true,
      }),
    ).toBeVisible();
    await ana
      .getByLabel("Efectivo recibido (CRC)", { exact: true })
      .fill("15000");
    await expect(
      ana.locator(".totals").filter({ hasText: "Vuelto" }),
    ).toContainText("4 000");
    await ana
      .getByRole("button", { name: "Revisar cierre", exact: true })
      .click();
    await expect(
      ana.getByRole("heading", {
        name: "Confirmar cierre de cuenta",
        exact: true,
      }),
    ).toBeVisible();
    await ana
      .getByRole("button", { name: "Confirmar y emitir factura", exact: true })
      .click();
    await expect(ana.locator(".receipt")).toBeVisible();
    await expect(ana.locator(".receipt-total")).toContainText("11");
    await expect(ana.locator(".receipt-payment")).toContainText("15 000");
    await expect(ana.locator(".receipt-payment")).toContainText("4 000");
    await expect(
      ana.getByRole("button", { name: "Imprimir comprobante", exact: true }),
    ).toHaveCount(0);
    await expect(ana.locator(".receipt-items")).toContainText("Vino tinto");
    await ana
      .locator(".receipt")
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await ana.screenshot({
      path: "test-artifacts/screenshots/05-factura-movil.png",
      fullPage: true,
    });
    expect(
      await ana.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await ana.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await ana
        .locator(".receipt")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    await closeModal(ana);

    await owner.getByRole("button", { name: "Clientes", exact: true }).click();
    await owner.getByLabel("Estado de cuentas").selectOption("closed");
    await card(owner, "Lucía Fernández", "Ver consumo");
    await owner
      .getByLabel("Cantidad registrada de Agua mineral por Ana Torres", {
        exact: true,
      })
      .fill("1");
    await owner
      .getByRole("button", { name: "Guardar corrección", exact: true })
      .click();
    await expect(
      owner.getByText("Consumo corregido e inventario actualizado", {
        exact: true,
      }),
    ).toBeVisible();
    await owner.getByRole("tab", { name: "Factura", exact: true }).click();
    await expect(
      owner.getByLabel("Versión de factura").locator("option"),
    ).toHaveCount(2);
    await expect(owner.locator(".receipt-total")).toContainText("11");
    await closeModal(owner);

    await owner.getByRole("button", { name: "Equipo", exact: true }).click();
    await expect(
      owner
        .locator(".team-card")
        .filter({
          has: owner.getByRole("heading", { name: "Leo Vega", exact: true }),
        })
        .getByRole("button", { name: "Ver consumo", exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("button", { name: "Agregar mesero", exact: true })
      .click();
    await owner.getByLabel("Nombre", { exact: true }).fill("Nueva compañera");
    await owner.getByLabel("Identificador", { exact: true }).fill("nueva");
    await owner
      .getByRole("button", { name: "Crear mesero", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "Nueva compañera", exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "Historial", exact: true }).click();
    await expect(
      owner.getByText("Mesero creado", { exact: true }).first(),
    ).toBeVisible();
    await owner.screenshot({
      path: "test-artifacts/screenshots/06-historial.png",
      fullPage: true,
    });
    await owner.getByRole("tab", { name: "Facturas", exact: true }).click();
    await owner
      .getByLabel("Vendedor", { exact: true })
      .selectOption({ label: "Ana Torres" }, { timeout: 8000 });
    await expect(
      owner.locator(".sales-row").filter({ hasText: "Lucía Fernández" }),
    ).toBeVisible();
    await owner.getByRole("tab", { name: "Movimientos", exact: true }).click();
    await owner
      .getByLabel("Vendedor", { exact: true })
      .selectOption({ label: "Leo Vega" }, { timeout: 8000 });
    await expect(
      owner
        .locator(".sales-row")
        .filter({ hasText: "Vino tinto" })
        .filter({ hasText: "Lucía Fernández" }),
    ).toContainText("Leo Vega");
    await expect(
      owner.locator(".sales-row").filter({ hasText: "Consumo personal" }),
    ).toContainText("Leo Vega");
    await owner
      .getByRole("button", { name: "Flujo de efectivo", exact: true })
      .click();
    await expect(owner.locator(".report-card")).toContainText("11 000");
    await expect(owner.locator(".report-card")).toContainText("15 000");
    await expect(owner.locator(".report-card")).toContainText("4 000");
    await expect(
      owner.getByRole("heading", { name: "Ventas diarias", exact: true }),
    ).toBeVisible();
    await expect(
      owner.getByRole("heading", { name: "Ventas por vendedor", exact: true }),
    ).toBeVisible();
    await owner.screenshot({
      path: "test-artifacts/screenshots/07-flujo-efectivo.png",
      fullPage: true,
    });
    await owner.getByLabel("Desde", { exact: true }).fill("2099-01-01");
    await owner.getByLabel("Hasta", { exact: true }).fill("2099-01-01");
    await expect(
      owner.getByText("Sin ventas en este intervalo", { exact: true }),
    ).toBeVisible();
    await ana.getByRole("button", { name: "Mis ventas", exact: true }).click();
    await expect(
      ana.locator(".sales-row").filter({ hasText: "Lucía Fernández" }),
    ).toBeVisible();
    await expect(ana.getByLabel("Vendedor", { exact: true })).toHaveCount(0);
    expect(
      await ana.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await ana.screenshot({
      path: "test-artifacts/screenshots/08-mis-ventas-movil.png",
      fullPage: true,
    });
    await ana.getByRole("button", { name: "Inicio", exact: true }).click();
    await ana.getByRole("combobox", { name: "Perfil de mesero" }).selectOption("leo");
    await ana.getByRole("button", { name: "Mesero", exact: true }).click();
    await expect(ana.getByText("En tiempo real", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
    await anaContext.close();
    await leoContext.close();
  }
});

test("alta y edición de producto, avisos, reconexión y sesión revocada", async ({
  browser,
}) => {
  const adminContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const waiterContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const owner = await adminContext.newPage(),
    waiter = await waiterContext.newPage();
  try {
    await login(owner, "dueno");
    await login(waiter, "ana");
    await waiter
      .locator(".customer-card")
      .filter({
        has: waiter.getByRole("heading", { name: "Camila Rojas", exact: true }),
      })
      .locator(".customer-open")
      .click();
    await owner
      .getByRole("button", { name: "Inventario", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    const photo = await sharp({
      create: { width: 60, height: 60, channels: 3, background: "#afc783" },
    })
      .png()
      .toBuffer();
    await owner.getByLabel("Foto del producto", { exact: true }).setInputFiles({
      name: "bebida.png",
      mimeType: "image/png",
      buffer: photo,
    });
    await expect(owner.locator(".photo-upload img")).toBeVisible();
    await owner.getByLabel("Nombre", { exact: true }).fill("Bebida nueva");
    await owner.getByLabel("Precio (CRC)", { exact: true }).fill("2750.50");
    await owner.getByLabel("Unidades disponibles", { exact: true }).fill("6");
    await owner
      .getByRole("button", { name: "Crear producto", exact: true })
      .click();
    const card = waiter.locator(".product-card").filter({
      has: waiter.getByRole("heading", { name: "Bebida nueva", exact: true }),
    });
    await expect(card).toBeVisible();
    await waiter
      .getByRole("button", { name: "Agregar Bebida nueva", exact: true })
      .click();
    const notice = waiter.getByText("Bebida nueva: quedarían 5 unidades", {
      exact: true,
    });
    await expect(notice).toBeVisible();
    expect(
      await notice.evaluate((el) =>
        el.closest("[popover]")?.matches(":popover-open"),
      ),
    ).toBe(true);
    await waiter
      .getByRole("button", { name: "Registrar pedido", exact: true })
      .click();
    await expect(
      waiter.getByText("Productos registrados", { exact: true }),
    ).toBeVisible();
    await expect(waiter.getByRole("dialog")).toBeHidden();
    await waiter
      .locator(".customer-card")
      .filter({
        has: waiter.getByRole("heading", { name: "Camila Rojas", exact: true }),
      })
      .locator(".customer-open")
      .click();
    const row = owner.locator(".inventory-row").filter({
      has: owner.getByRole("heading", { name: "Bebida nueva", exact: true }),
    });
    await expect(row.locator(".stock-count")).toContainText("5");

    await waiterContext.setOffline(true);
    await expect(
      waiter.getByText("Reconectando…", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await owner
      .getByRole("button", { name: "Editar Bebida nueva", exact: true })
      .click();
    await owner.getByLabel("Precio (CRC)", { exact: true }).fill("2900");
    await owner.getByLabel("Unidades disponibles", { exact: true }).fill("9");
    await owner
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    await waiterContext.setOffline(false);
    await expect(
      waiter.getByText("En tiempo real", { exact: true }),
    ).toBeVisible();
    await expect(card.locator(".stock-tag")).toHaveText("9 disponibles");
    await expect(card.locator(".product-body>strong")).toContainText("2 900");
    await waiter.getByRole("tab", { name: /^Consumo/ }).click();
    await expect(
      waiter.locator(".consumption-row").filter({
        has: waiter.getByRole("heading", {
          name: "Bebida nueva",
          exact: true,
        }),
      }),
    ).toContainText("2 750,50");
    await closeModal(waiter);

    await owner.getByRole("button", { name: "Equipo", exact: true }).click();
    await owner.getByRole("button", { name: "Eliminar acceso de Ana Torres", exact: true }).click();
    await owner.getByRole("button", { name: "Eliminar", exact: true }).click();
    await expect(waiter.getByRole("button", { name: "Dueño", exact: true })).toBeVisible();
  } finally {
    await adminContext.close();
    await waiterContext.close();
  }
});

test("tema persistente con fundido suave en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Dueño", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cambiar a modo oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => document.getAnimations().some(a => {
    const effect = a.effect as KeyframeEffect;
    const frames = effect.getKeyframes();
    return effect.pseudoElement === "::view-transition-new(root)" && Number(frames[0].opacity) === 0 && Number(frames.at(-1)?.opacity) === 1;
  }))).toBeTruthy();
  await page.evaluate(() => document.getAnimations().filter(a => (a.effect as KeyframeEffect).pseudoElement === "::view-transition-new(root)").forEach(a => { a.pause(); a.currentTime = 275; }));
  await page.screenshot({ path: "test-artifacts/screenshots/tema-fundido.png" });
  await page.evaluate(() => document.getAnimations().forEach(a => { if (a.playState === "paused") a.play(); }));
  await expect(page.getByRole("button", { name: "Cambiar a modo claro", exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-artifacts/screenshots/tema-oscuro-movil.png", fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Dueño", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await login(page, "leo");
  await expect(page.locator(".customer-card").first()).toBeVisible();
  await page.screenshot({ path: "test-artifacts/screenshots/tema-oscuro-clientes.png", fullPage: true });
  await page.getByRole("button", { name: "Cambiar a modo claro", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cambiar a modo oscuro", exact: true })).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Cambiar a modo oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Cambiar a modo claro", exact: true })).toBeEnabled();
  // Older browsers smoothly interpolate the actual theme colors.
  await page.evaluate(() => Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Cambiar a modo claro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveClass("theme-changing");
  expect(await page.locator(".customer-card").first().evaluate(el => getComputedStyle(el).transitionDuration)).toContain("0.55s");
  await expect(page.locator("html")).not.toHaveClass("theme-changing");
});

test("contador de efectivo para dueño y mesero: sumas, validación y reinicio", async ({ browser }) => {
  const format = (value: number) => new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(value);
  await mkdir("test-artifacts/screenshots", { recursive: true });
  for (const [username, width] of [["dueno", 1440], ["leo", 390]] as const) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await login(page, username);
      const writes: string[] = [];
      page.on("request", request => { if (["POST", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url()); });
      await page.getByRole("button", { name: "Contar efectivo", exact: true }).click();
      const total = page.getByLabel("Total contado", { exact: true });
      const coins = page.getByRole("textbox", { name: "Cantidad de monedas de ₡500", exact: true });
      await expect(total).toHaveText(format(0));
      const addCoin = page.getByRole("button", { name: "Agregar una moneda de ₡500", exact: true });
      const removeCoin = page.getByRole("button", { name: "Quitar una moneda de ₡500", exact: true });
      await expect(removeCoin).toBeDisabled();
      await addCoin.click(); await addCoin.click(); await addCoin.click();
      await expect(coins).toHaveValue("3");
      await expect(total).toHaveText(format(1500));
      await removeCoin.click();
      await expect(total).toHaveText(format(1000));
      await addCoin.click();
      await coins.fill("1000000");
      await expect(addCoin).toBeDisabled();
      await removeCoin.click();
      await expect(coins).toHaveValue("999999");
      await coins.fill("3");
      await expect(total).toHaveText(format(1500));
      await page.getByRole("textbox", { name: "Cantidad de billetes de ₡10000", exact: true }).fill("2");
      await page.getByRole("textbox", { name: "Cantidad de monedas de ₡25", exact: true }).fill("4");
      await expect(total).toHaveText(format(21600));
      await page.getByRole("button", { name: "Agregar un billete de ₡10000", exact: true }).click();
      await expect(total).toHaveText(format(31600));
      await page.getByRole("button", { name: "Quitar un billete de ₡10000", exact: true }).click();
      await expect(total).toHaveText(format(21600));
      await expect(page.getByLabel("Total en billetes", { exact: true })).toHaveText(format(20000));
      await expect(page.getByLabel("Total en monedas", { exact: true })).toHaveText(format(1600));
      for (const invalid of ["-1", "1.5", "1e3", "1000001", "10000000"]) {
        await coins.fill(invalid);
        await expect(coins).toHaveAttribute("aria-invalid", "true");
        await expect(addCoin).toBeDisabled();
        await expect(removeCoin).toBeDisabled();
        await expect(total).toHaveText("Revisa las cantidades");
      }
      await coins.fill("3");
      await page.getByRole("button", { name: username === "dueno" ? "Clientes" : "Mis clientes", exact: true }).click();
      await page.getByRole("button", { name: "Contar efectivo", exact: true }).click();
      await expect(total).toHaveText(format(21600));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-artifacts/screenshots/efectivo-${username}-claro.png`, fullPage: true });
      await page.getByRole("button", { name: "Cambiar a modo oscuro", exact: true }).click();
      await page.screenshot({ path: `test-artifacts/screenshots/efectivo-${username}-oscuro.png`, fullPage: true });
      for (const narrowWidth of [1024, 390, 320]) {
        await page.setViewportSize({ width: narrowWidth, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      const size = await addCoin.boundingBox();
      expect(size!.width).toBeGreaterThanOrEqual(44);
      expect(size!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `test-artifacts/screenshots/efectivo-${username}-estrecho.png`, fullPage: true });
      await page.getByRole("button", { name: "Limpiar conteo", exact: true }).click();
      await expect(total).toHaveText(format(0));
      await expect(coins).toHaveValue("");
      await expect(page.getByRole("button", { name: "Limpiar conteo", exact: true })).toBeDisabled();
      await coins.fill("3");
      await page.reload();
      await page.getByRole("button", { name: "Contar efectivo", exact: true }).click();
      await expect(total).toHaveText(format(0));
      expect(writes).toEqual([]);
    } finally { await context.close(); }
  }
});
