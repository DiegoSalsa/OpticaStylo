import { test, expect } from "@playwright/test";
import { prisma } from "../src/db/prisma.js";
import { requireAcademicIsolation, ids as people } from "../tests/fixtures/academic-data.js";
import { seedCatalogData } from "../tests/fixtures/catalog-data.js";
import { ids } from "../scripts/seed-store-e2e.mjs";
import { isolateBrowserNetwork } from "./isolated-network.js";
import { formatInTimeZone } from "date-fns-tz";
import { createSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/auth/session-token.js";
import { readFile } from "node:fs/promises";

test.beforeAll(async () => { requireAcademicIsolation(); await seedCatalogData(); });
test.beforeEach(async ({ context }) => {
  requireAcademicIsolation();
  await prisma.public_request_rate_limits.deleteMany();
  await isolateBrowserNetwork(context);
});
test.afterAll(async () => prisma.$disconnect());

// Esperar la respuesta visible evita medir esqueletos como resultados definitivos.
async function ready(page) {
  await expect(page.getByRole("status")).toContainText(/Mostrando/);
  await expect(page.locator('section[aria-busy="true"]')).toHaveCount(0);
}

test("buscador del encabezado en escritorio y móvil, filtros repetidos e historial", async ({ page }) => {
  for (const width of [1440, 1280, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/contacto");
    if (width < 900) await page.getByLabel("Abrir menú").click();
    const form = page.locator(width < 900 ? ".mobile-menu__search" : ".public-header__search");
    await form.getByRole("searchbox").fill("Ray-Ban");
    await form.getByRole("button", { name: "Buscar en la tienda" }).click();
    await ready(page);
    await expect(page.locator("#catalog-search")).toHaveValue("Ray-Ban");
    await expect(page.getByRole("heading", { name: "Ray-Ban RB2140", exact: true })).toBeVisible();
    const requests = [];
    page.on("request", (request) => { if (request.url().includes("/api/store/products?")) requests.push(request.url()); });
    await page.getByRole("button", { name: "Todos", exact: true }).click();
    await page.locator("#catalog-search").press("Enter");
    await expect(page.getByRole("status")).toContainText("Mostrando 1–1 de 1");
    expect(requests).toHaveLength(0);
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await ready(page);
    await expect(page.locator("#catalog-search")).toHaveValue("");
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await ready(page);
    await page.goBack();
    await ready(page);
    await expect(page.locator("#catalog-search")).toHaveValue("Ray-Ban");
    await page.goForward();
    await ready(page);
    await expect(page.locator("#catalog-search")).toHaveValue("");
  }
});

test("catálogo: páginas reales, orden global, receta, disponibilidad y página fuera de rango", async ({ page }) => {
  await page.goto("/tienda?search=CatalogoDemo&sort=price-asc");
  await ready(page);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Filtros");
  await expect(page.locator('article h2').first()).toHaveText("CatalogoDemo054");
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await ready(page);
  await expect(page.getByText("Página 2 de 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("status")).toContainText("Mostrando 49–55 de 55");
  await page.getByRole("combobox", { name: "Ordenar por" }).selectOption("newest");
  await ready(page);
  await expect(page.getByText("Página 1 de 3", { exact: true })).toBeVisible();
  await expect(page.locator('article h2').first()).toHaveText("CatalogoDemo054");
  await page.getByRole("radio", { name: "Con receta opcional", exact: true }).check();
  await page.getByRole("checkbox", { name: "Mostrar disponibles" }).check();
  await ready(page);
  await expect(page.getByRole("status")).toContainText("de 27 productos");
  await page.getByRole("button", { name: "Accesorios", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No encontramos productos" })).toBeVisible();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await ready(page);
  await page.goto("/tienda?search=CatalogoDemo&page=99");
  await expect(page).toHaveURL(/page=3/);
  await ready(page);
  await expect(page.getByText("Página 3 de 3", { exact: true })).toBeVisible();
});

test("catálogo: error recuperable y respuesta atrasada no reemplaza la búsqueda nueva", async ({ page }) => {
  let fail = true;
  await page.route("**/api/store/products?*", async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { success: false, error: { message: "Detalle interno que no debe mostrarse" } } });
    return route.continue();
  });
  await page.goto("/tienda");
  await expect(page.getByRole("heading", { name: "No pudimos cargar el catálogo" })).toBeVisible();
  await expect(page.getByText("Detalle interno que no debe mostrarse")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Intentar nuevamente" }).click();
  await ready(page);
  await page.unroute("**/api/store/products?*");
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let observed;
  const started = new Promise((resolve) => { observed = resolve; });
  await page.route("**/api/store/products?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("search") === "Harley") {
      const response = await route.fetch();
      observed();
      await blocked;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await page.locator("#catalog-search").fill("Harley");
  await page.locator("#catalog-search").press("Enter");
  await started;
  await page.locator("#catalog-search").fill("Ray-Ban");
  await page.locator("#catalog-search").press("Enter");
  await ready(page);
  release();
  await expect(page.locator("article h2")).toHaveText("Ray-Ban RB2140");
  await expect(page.locator("#catalog-search")).toHaveValue("Ray-Ban");
});

test("receta: fallo de imagen permite continuar con ingreso manual y conservar el carrito", async ({ page }) => {
  // Provocar una indisponibilidad recuperable aunque el entorno tenga Cloudinary configurado.
  await page.route("**/api/store/cart/prescription/image", (route) => route.fulfill({
    status: 503, json: { success: false, error: { code: "MEDIA_STORAGE_UNAVAILABLE", message: "El almacenamiento de archivos no está disponible." } },
  }));
  await page.goto(`/tienda/${ids.frame}`);
  await page.getByRole("radio", { name: /Cristal monofocal de prueba/ }).check();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await page.locator('input[type="file"]').setInputFiles({ name: "receta.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=", "base64") });
  await expect(page.locator(".prescription-card").getByRole("alert")).toContainText(/almacenamiento|configurado/i);
  await page.getByRole("button", { name: "Ingresar manualmente" }).click();
  await page.locator('[name="rightSphere"]').fill("-1");
  await page.locator('[name="rightCylinder"]').fill("0");
  await page.locator('[name="leftSphere"]').fill("-0.75");
  await page.locator('[name="leftCylinder"]').fill("0");
  await page.getByRole("button", { name: "Guardar receta obligatoria" }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('[name="rightSphere"]')).toHaveValue("-1");
  await expect(page.getByText("Harley-Davidson HD0896", { exact: true })).toBeVisible();
});

test("reserva pública: profesional, horario real y paciente persisten en agenda", async ({ page }) => {
  await page.goto("/reservar");
  await page.getByLabel("Profesional", { exact: true }).selectOption(people.professional);
  const date = formatInTimeZone(new Date(Date.now() + 2 * 86400000), "America/Santiago", "yyyy-MM-dd");
  const availability = page.waitForResponse((response) => response.url().includes("/availability?"));
  await page.getByLabel("Fecha", { exact: true }).fill(date);
  const { data } = await (await availability).json();
  const slot = data.slots[0];
  const time = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" }).format(new Date(slot.startAt));
  await page.getByRole("button", { name: time, exact: true }).click();
  for (const [name, value] of Object.entries({ firstNames: "ReservaDemo", lastNames: "Sintética", rut: "12345678-5", birthDate: "1990-01-01", email: "reserva-demo@example.invalid", phone: "+56912345678", address: "Dirección ficticia" })) {
    await page.locator(`[name="${name}"]`).fill(value);
  }
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.getByRole("heading", { name: "Tu hora quedó agendada" })).toBeVisible();
  const record = await prisma.appointments.findFirst({ where: { professional_id: people.professional, start_at: new Date(slot.startAt) }, include: { patients: true } });
  expect(record.patients.first_names).toBe("ReservaDemo");
});

test("reserva: limpiar profesional o recibir una disponibilidad atrasada descarta la selección anterior", async ({ page }) => {
  await page.goto("/reservar");
  await page.getByLabel("Profesional", { exact: true }).selectOption(people.professional);
  const date = formatInTimeZone(new Date(Date.now() + 3 * 86400000), "America/Santiago", "yyyy-MM-dd");
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let observed;
  const started = new Promise((resolve) => { observed = resolve; });
  await page.route(`**/professionals/${people.professional}/availability?*`, async (route) => {
    const response = await route.fetch();
    observed();
    await blocked;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByLabel("Fecha", { exact: true }).fill(date);
  await started;
  await page.getByLabel("Profesional", { exact: true }).selectOption("");
  release();
  await expect(page.getByRole("button", { name: "Confirmar reserva" })).toBeDisabled();
  await expect(page.getByText("Consultando agenda…", { exact: true })).toHaveCount(0);
  await expect(page.locator('button').filter({ hasText: /^\d{2}:\d{2}/ })).toHaveCount(0);
});

test("páginas públicas a 1440, 1280, 768, 390 y 360 sin desbordamiento ni errores de hidratación", async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 1280, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [slug, path] of [["home", "/"], ["catalogo", "/tienda"], ["detalle", `/tienda/${ids.frame}`], ["carrito", "/carrito"], ["reserva", "/reservar"], ["cuenta", "/cuenta"], ["contacto", "/contacto"], ["terminos", "/terminos"], ["privacidad", "/privacidad"], ["vto", "/virtual-try-on/3d"]]) {
      await page.goto(path);
      if (slug === "catalogo") await ready(page);
      if (slug === "detalle") await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeEnabled();
      if (slug === "vto") await expect(page.locator('article[data-selected="true"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${slug} a ${width}px`).toBe(true);
      await page.screenshot({ path: `tmp/store-e2e/demo-${slug}-${width}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test("agenda, ficha y reportes internos conservan el diseño móvil y aplicar el mismo reporte termina la carga", async ({ page, context }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [userId, paths] of [[people.admin, ["agenda", "reportes"]], [people.professional, ["ficha-clinica"]]]) {
    const token = createSessionToken();
    await prisma.user_sessions.create({ data: { user_id: userId, token_hash: hashSessionToken(token), expires_at: new Date(Date.now() + 3600000) } });
    await context.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: process.env.STORE_E2E_BASE_URL, httpOnly: true, sameSite: "Lax" }]);
    for (const width of [1440, 1280, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of paths) {
        await page.goto(`/app/${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path === "reportes") {
          await expect(page.locator(".report-metrics")).toBeVisible();
          await page.locator(".report-filters button[type=submit]").click();
          await expect(page.locator(".report-metrics")).toBeVisible();
          await page.locator(".report-filters button[type=submit]").click();
          await expect(page.locator(".report-metrics")).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} a ${width}px`).toBe(true);
        await page.screenshot({ path: `tmp/store-e2e/demo-internal-${path}-${width}.png`, fullPage: true });
      }
    }
  }
  expect(errors).toEqual([]);
});

test("usuarios: cambiar roles revoca la sesión anterior y se rechaza autodesactivar al administrador", async ({ context, browser }) => {
  // Emitir sesiones únicamente para usuarios del fixture aislado, sin guardar contraseñas.
  const authenticate = async (target, userId) => {
    const token = createSessionToken();
    await prisma.user_sessions.create({ data: { user_id: userId, token_hash: hashSessionToken(token), expires_at: new Date(Date.now() + 3600000) } });
    await target.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: process.env.STORE_E2E_BASE_URL, httpOnly: true, sameSite: "Lax" }]);
  };
  await authenticate(context, people.admin);
  const victim = await browser.newContext({ baseURL: process.env.STORE_E2E_BASE_URL });
  try {
    await authenticate(victim, people.otherProfessional);
    expect((await victim.request.get("/api/auth/me")).status()).toBe(200);
    const changed = await context.request.patch(`/api/users/${people.otherProfessional}`, { data: { roles: ["SALES"] } });
    expect(changed.status()).toBe(200);
    expect((await victim.request.get("/api/auth/me")).status()).toBe(401);
    expect((await context.request.patch(`/api/users/${people.admin}`, { data: { isActive: false } })).status()).toBe(409);
    expect((await context.request.get("/api/auth/me")).status()).toBe(200);
  } finally {
    // Restaurar exclusivamente el perfil sintético para permitir repetir esta regresión.
    await context.request.patch(`/api/users/${people.otherProfessional}`, { data: { roles: ["CLINICAL_PROFESSIONAL"] } });
    await victim.close();
  }
});

test("reportes: exportar un producto con separador conserva las columnas CSV", async ({ page, context }) => {
  const token = createSessionToken();
  await prisma.user_sessions.create({ data: { user_id: people.admin, token_hash: hashSessionToken(token), expires_at: new Date(Date.now() + 3600000) } });
  await context.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: process.env.STORE_E2E_BASE_URL, httpOnly: true, sameSite: "Lax" }]);
  const product = await prisma.products.upsert({ where: { sku: "DEMO-CSV" }, update: {}, create: {
    sku: "DEMO-CSV", name: "Producto;CSV", category: "ACCESSORY", unit_price_cents: 1000, is_test_data: true, created_by: people.admin, updated_by: people.admin,
  } });
  const saleId = "30000000-0000-4000-8000-000000000001";
  await prisma.sales.upsert({ where: { id: saleId }, update: {}, create: {
    id: saleId, request_key: "demo-report-csv", status: "PENDING", subtotal_cents: 1000, total_cents: 1000, created_by: people.admin,
    sale_items: { create: { product_id: product.id, product_sku: product.sku, product_name: product.name, product_category: "ACCESSORY", requires_prescription: false, quantity: 1, unit_price_cents: 1000, position: 1 } },
  } });
  await page.goto("/app/reportes");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar productos CSV" }).click();
  const file = await (await download).path();
  const csv = await readFile(file, "utf8");
  expect(csv).toContain('"Producto;CSV";DEMO-CSV;1;1000');
});
