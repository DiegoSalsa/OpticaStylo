import { test, expect } from "@playwright/test";
import { prisma } from "../src/db/prisma.js";
import { ids, requireIsolatedStoreDatabase } from "../scripts/seed-store-e2e.mjs";
import { getCloudinaryMediaGateway } from "../src/integrations/media/cloudinary-media-gateway.js";

const syntheticImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=", "base64");
test.beforeAll(() => requireIsolatedStoreDatabase());
test.afterEach(async () => {
  // Aislar las cuotas entre escenarios; las acciones del cliente usan solo la tienda pública.
  await prisma.public_request_rate_limits.deleteMany();
});
test.afterAll(async () => {
  const images = await prisma.external_prescriptions.findMany({ where: { cloudinary_asset_id: { not: null } } });
  for (const image of images) expect(await getCloudinaryMediaGateway().deletePrivatePrescription({ publicId: image.cloudinary_public_id })).toBe(true);
  await prisma.$disconnect();
});

async function openFrame(page, lensName = "Cristal monofocal de prueba") {
  await page.goto(`/tienda/${ids.frame}`);
  await expect(page.getByRole("heading", { name: "Harley-Davidson HD0896", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: new RegExp(lensName) }).check();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: "Ver carrito", exact: true }).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByRole("heading", { name: "Receta óptica obligatoria" })).toBeVisible();
}
async function fillPrescription(page) {
  await page.locator('[name="rightSphere"]').fill("-1.12");
  await page.locator('[name="rightCylinder"]').fill("-0.5");
  await page.locator('[name="rightAxis"]').fill("90");
  await page.locator('[name="leftSphere"]').fill("-1");
  await page.locator('[name="leftCylinder"]').fill("0");
  await page.locator('[name="pupillaryDistance"]').fill("62.25");
  await page.locator('[name="fulfillmentNotes"]').fill("Receta sintética de prueba");
}
async function fillBuyer(page, rut = "12345678-5") {
  for (const [field, value] of Object.entries({ rut, firstNames: "Invitado", lastNames: "Prueba", phone: "+56912345678", email: "checkout@example.invalid", address: "Calle de prueba 123", notes: "Retiro de prueba" })) {
    await page.locator(`.buyer-form [name="${field}"]`).fill(value);
  }
}
async function createOrder(page) {
  await fillBuyer(page);
  const responsePromise = page.waitForResponse((r) => r.url().endsWith("/api/store/cart/checkout") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Continuar a Mercado Pago" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const { data } = await response.json();
  expect(data.paymentError.code).toBe("PAYMENT_PROVIDER_NOT_CONFIGURED");
  await expect(page).toHaveURL(new RegExp(`/checkout/mercado-pago/pending\\?orderId=${data.order.id}`));
  await expect(page.getByText(`N.º ${data.order.saleNumber}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Intentar pagar nuevamente" })).toBeVisible();
  return data.order;
}

test("invitado: receta manual, recarga, navegación, edición y pedido completo", async ({ page }) => {
  await openFrame(page);
  await page.getByRole("button", { name: "Ingresar manualmente" }).click();
  await fillPrescription(page);
  await fillBuyer(page);
  await page.reload();
  await expect(page.locator('[name="rightSphere"]')).toHaveValue("-1.12");
  await expect(page.locator('[name="firstNames"]')).toHaveValue("Invitado");
  await expect(page.getByRole("button", { name: "Continuar a Mercado Pago" })).toBeDisabled();
  await page.getByRole("button", { name: "Guardar receta obligatoria" }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await page.goto("/tienda");
  await page.goto("/carrito");
  await expect(page.locator('[name="rightSphere"]')).toHaveValue("-1.12");
  await page.getByRole("link", { name: "Modificar cristales" }).click();
  await expect(page.getByRole("radio", { name: /Cristal monofocal de prueba/ })).toBeChecked();
  await page.getByRole("radio", { name: /Cristal filtro azul de prueba/ }).check();
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await page.getByRole("link", { name: "Ver carrito", exact: true }).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByText("Cristal monofocal de prueba", { exact: true })).toHaveCount(0);
  await expect(page.locator('[name="rightSphere"]')).toHaveValue("-1.12");
  const order = await createOrder(page);
  expect(order.totalCents).toBe(75000);
  expect(order.customer.email).toBe("checkout@example.invalid");
  expect(order.items.find((i) => i.productId === ids.otherLens).mount.frameProductId).toBe(ids.frame);
  const stored = await prisma.external_prescriptions.findUnique({ where: { id: order.externalPrescription.id } });
  expect(stored.confirmed_data.pupillaryDistance).toBe(62.25);
  await page.screenshot({ path: `tmp/store-e2e/${test.info().project.name}-manual-order.png`, fullPage: true });
});

test("invitado: imagen privada, vista previa, reemplazo y confirmación sin extracción", async ({ page }) => {
  await openFrame(page);
  // Antes de cargar no hay campos requeridos que puedan bloquear el archivo.
  await expect(page.locator('.prescription-form input[required]')).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles({ name: "receta-prueba.png", mimeType: "image/png", buffer: syntheticImage });
  await expect(page.getByText("La imagen está guardada.", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Receta guardada de forma privada" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "receta-reemplazo.png", mimeType: "image/png", buffer: syntheticImage });
  await expect(page.getByRole("button", { name: "Completar valores manualmente" })).toBeEnabled();
  await page.getByRole("button", { name: "Completar valores manualmente" }).click();
  await fillPrescription(page);
  await page.getByRole("button", { name: "Confirmar valores revisados" }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('[name="rightSphere"]')).toHaveValue("-1.12");
  const order = await createOrder(page);
  expect(order.externalPrescription.source).toBe("IMAGE");
  expect(order.totalCents).toBe(70000);
});

test("invitado: accesorio sin receta, pedido ajeno denegado y nueva compra conserva acceso al anterior", async ({ page, browser }) => {
  await page.goto(`/tienda/${ids.accessory}`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: "Ver carrito", exact: true }).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByRole("heading", { name: "Receta óptica obligatoria" })).toHaveCount(0);
  const order = await createOrder(page);
  const alien = await browser.newContext();
  expect((await alien.request.get(`${test.info().config.use?.baseURL ?? process.env.STORE_E2E_BASE_URL}/api/store/orders/${order.id}`)).status()).toBe(404);
  await alien.close();
  await page.goto(`/tienda/${ids.accessory}`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: "Ver carrito", exact: true }).click();
  await expect(page).toHaveURL(/\/carrito$/);
  await expect(page.getByText("Estuche de prueba", { exact: true })).toBeVisible();
  await page.goto(`/checkout/mercado-pago/pending?orderId=${order.id}`);
  await expect(page.getByText(`N.º ${order.saleNumber}`, { exact: true })).toBeVisible();
});

test("VTO: dos badges, navegación al modelo correcto y sin ajustes visuales", async ({ page }) => {
  await page.goto("/tienda");
  await expect(page.getByText("Prueba virtual", { exact: true })).toHaveCount(2);
  for (const [id, sku] of [[ids.frame, "HD0896-001"], [ids.rayban, "RB2140-901-50"]]) {
    await page.goto(`/tienda/${id}`);
    await page.getByRole("link", { name: "Probar en 3D", exact: true }).click();
    await expect(page.locator('article[data-selected="true"]')).toContainText(sku);
    await expect(page.getByText("Ajustes visuales", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("slider", { name: /Brillo|Contraste/ })).toHaveCount(0);
  }
  await page.screenshot({ path: `tmp/store-e2e/${test.info().project.name}-vto.png`, fullPage: true });
});

test("cliente autenticado: registro público, receta y pedido propio", async ({ page }) => {
  await page.goto("/cuenta");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  const rut = test.info().project.name === "desktop" ? "22222222-2" : "33333333-3";
  for (const [field, value] of Object.entries({ rut, firstNames: "Cliente", lastNames: "Prueba", phone: "+56912345678", email: `${test.info().project.name}@example.invalid`, address: "Calle prueba 123", password: "ClavePruebaSegura2026!" })) {
    await page.locator(`form [name="${field}"]`).fill(value);
  }
  await page.getByRole("button", { name: "Crear cuenta segura" }).click();
  await expect(page.getByRole("heading", { name: "Hola, Cliente" })).toBeVisible();
  await openFrame(page);
  await page.getByRole("button", { name: "Ingresar manualmente" }).click();
  await fillPrescription(page);
  await page.getByRole("button", { name: "Guardar receta obligatoria" }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  const order = await createOrder(page);
  expect(order.externalPrescription.status).toBe("READY");
  await page.goto("/cuenta");
  await expect(page.getByText(`Pedido N.º ${order.saleNumber}`, { exact: false })).toBeVisible();
});
