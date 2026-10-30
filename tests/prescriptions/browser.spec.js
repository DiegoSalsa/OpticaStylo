import { test, expect } from "@playwright/test";
import { buyer, ids, database } from "./helpers.js";
import { evaluation } from "../evaluation-data.js";
import { fixtureRut } from "../rut-fixture.js";

test.beforeEach(async () => { const db = database(); try { await db.public_request_rate_limits.deleteMany(); } finally { await db.$disconnect(); } });

async function productToCart(page, withLenses = true) {
  await page.goto(`/tienda/${ids.frame}`);
  await expect(page.getByRole("heading", { name: "Marco sin VTO", exact: true })).toBeVisible();
  if (withLenses) await page.getByRole("radio", { name: /Cristal monofocal de prueba/ }).check();
  await page.getByRole("button", { name: "Agregar al carrito", exact: true }).click();
  await expect(page).toHaveURL(/\/carrito/);
  await expect(page.getByRole("heading", { name: "Completa tu compra" })).toBeVisible();
}
async function fillPrescription(page) {
  for (const [name, value] of [["rightSphere", "-1.25"], ["rightCylinder", "-0.5"], ["rightAxis", "90"],
    ["leftSphere", "-2"], ["leftCylinder", "0"], ["pupillaryDistance", "62"]]) await page.locator(`[name="${name}"]`).fill(value);
}
async function checkout(page, unique) {
  for (const [name, value] of Object.entries({ ...buyer, rut: fixtureRut(unique), firstNames: `RecetaNavegador${unique}` })) {
    await page.locator(`.buyer-form [name="${name}"]`).fill(value);
  }
  await page.getByRole("button", { name: "Continuar a Mercado Pago", exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/mercado-pago\/pending\?orderId=/);
  await page.getByText("Ver receta del pedido", { exact: true }).click();
  await expect(page.getByRole("table")).toContainText("-1.25");
  await expect(page.locator("body")).not.toContainText("Error interno");
}
test("Regresión de navegación: elegir receta abre configuración local, valida y conserva datos", async ({ page }) => {
  await productToCart(page, false);
  const initialURL = page.url(); let navigated = false;
  const navigation = (frame) => { if (frame === page.mainFrame()) navigated = true; };
  page.on("framenavigated", navigation);
  await page.getByRole("radio", { name: /Necesito cristales con receta/ }).check();
  await expect(page.getByLabel("Cristales para Marco sin VTO")).toBeVisible();
  expect(page.url()).toBe(initialURL); expect(navigated).toBe(false);
  page.off("framenavigated", navigation);
  await page.getByLabel("Cristales para Marco sin VTO").selectOption(ids.lens);
  await page.getByRole("button", { name: "Guardar cristales", exact: true }).click();
  await page.getByRole("button", { name: "Ingresar manualmente", exact: true }).click();
  await fillPrescription(page);
  await page.locator('[name="rightAxis"]').fill("181");
  await page.getByRole("button", { name: "Guardar receta obligatoria", exact: true }).click();
  expect(await page.locator('[name="rightAxis"]').evaluate((input) => input.validity.rangeOverflow)).toBe(true);
  await expect(page.getByText("Receta lista", { exact: true })).toHaveCount(0);
  await page.locator('[name="rightAxis"]').fill("90");
  await page.locator('.buyer-form [name="firstNames"]').fill("Borrador conservado");
  await page.goto("/tienda"); await page.goBack();
  await expect(page.locator('[name="rightSphere"]')).toHaveValue("-1.25");
  await expect(page.locator('.buyer-form [name="firstNames"]')).toHaveValue("Borrador conservado");
  await page.getByRole("button", { name: "Guardar receta obligatoria", exact: true }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator('[name="rightSphere"]')).toHaveValue("-1.25");
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Compra invitada y visualización posterior por el cliente y un empleado autorizado", async ({ page }, info) => {
  const unique = info.project.name === "movil" ? 9402 : 9401;
  await productToCart(page);
  await page.getByRole("button", { name: "Ingresar manualmente", exact: true }).click();
  await fillPrescription(page);
  await page.getByRole("button", { name: "Guardar receta obligatoria", exact: true }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await checkout(page, unique);
  const orderId = new URL(page.url()).searchParams.get("orderId");
  await page.reload(); await page.getByText("Ver receta del pedido", { exact: true }).click();
  await expect(page.getByRole("table")).toContainText("-1.25");
  const db = database();
  try {
    const order = await db.sales.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.external_prescription_id).toBeTruthy();
    await page.goto("/ingresar");
    await page.getByLabel("Correo electrónico", { exact: true }).fill(evaluation.adminEmail);
    await page.getByLabel("Contraseña", { exact: true }).fill(evaluation.password);
    await page.getByRole("button", { name: "Ingresar de forma segura" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/pedidos");
    await page.getByRole("textbox", { name: "Buscar pedido" }).fill(`#${order.sale_number}`);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.getByRole("region", { name: "Pendiente", exact: true }).getByRole("button", { name: "Ver detalle", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Ver receta del pedido", { exact: true }).click();
    await expect(dialog.getByRole("table")).toContainText("-1.25");
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.goto("/app/clientes");
    await page.getByRole("textbox", { name: "Buscar clientes", exact: true }).fill(fixtureRut(unique));
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await page.locator(".management-item").filter({ hasText: `RecetaNavegador${unique}` }).click();
    await page.getByText(/^Ver receta del /).click();
    await expect(page.getByRole("table")).toContainText("-1.25");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await db.$disconnect(); }
});

test("Una cuenta registrada conserva su receta en Mis pedidos y permite consultarla tras volver a ingresar", async ({ page }, info) => {
  const unique = info.project.name === "movil" ? 9406 : 9405;
  const email = `cuenta-receta-${unique}@example.invalid`;
  await page.goto("/cuenta");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  for (const [name, value] of Object.entries({ ...buyer, rut: fixtureRut(unique), email, password: "Receta-cuenta-segura-2026!" })) {
    await page.locator(`form [name="${name}"]`).fill(value);
  }
  await page.getByRole("button", { name: "Crear cuenta segura", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hola,/ })).toBeVisible();
  await productToCart(page);
  await page.getByRole("button", { name: "Ingresar manualmente", exact: true }).click();
  await fillPrescription(page);
  await page.getByRole("button", { name: "Guardar receta obligatoria", exact: true }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await checkout(page, unique);
  await page.goto("/cuenta");
  await page.getByText("Ver receta del pedido", { exact: true }).click();
  await expect(page.getByRole("table")).toContainText("-1.25");
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await page.locator('form [name="email"]').fill(email);
  await page.locator('form [name="password"]').fill("Receta-cuenta-segura-2026!");
  await page.locator("form").getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.getByText("Ver receta del pedido", { exact: true }).click();
  await expect(page.getByRole("table")).toContainText("-1.25");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Imagen real: vista previa, quitar, validación, carga privada y continuación manual sin IA", async ({ page }, info) => {
  test.skip(process.env.PRESCRIPTION_LIVE_STORAGE !== "true", "Requiere --live-storage y credenciales existentes.");
  await page.setContent('<main style="background:white;padding:30px;font:24px Arial"><h1>RECETA SINTÉTICA DE PRUEBA</h1><p>OD: esfera -1.25, cilindro -0.50, eje 90</p><p>OI: esfera -2.00, cilindro 0.00</p><p>DP: 62 mm. Sin uso clínico.</p></main>');
  const png = await page.locator("main").screenshot();
  await productToCart(page);
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles({ name: "receta.txt", mimeType: "text/plain", buffer: Buffer.from("falso") });
  await expect(page.getByRole("alert").first()).toContainText("hasta 4 MiB");
  await picker.setInputFiles({ name: "receta-sintetica.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Vista previa de la receta seleccionada")).toBeVisible();
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(page.getByAltText("Vista previa de la receta seleccionada")).toHaveCount(0);
  await picker.setInputFiles({ name: "receta-sintetica.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Guardar imagen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Completar valores manualmente", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Abrir imagen guardada", exact: true })).toBeVisible();
  await fillPrescription(page);
  await page.getByRole("button", { name: "Confirmar valores revisados", exact: true }).click();
  await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText("Receta lista", { exact: true })).toBeVisible();
  await checkout(page, info.project.name === "movil" ? 9404 : 9403);
  const stored = page.getByAltText("Imagen de la receta registrada");
  await expect(stored).toBeVisible();
  await expect.poll(() => stored.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
