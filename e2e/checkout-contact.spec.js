import { test, expect } from "@playwright/test";
import { prisma } from "../src/db/prisma.js";
import { requireAcademicIsolation, seedAcademicData } from "../tests/fixtures/academic-data.js";
import { seedAccountHistory } from "../tests/fixtures/account-history-data.js";
import { cartDraftKey } from "../src/utils/store-cart-draft.js";
import { formatChileanRut } from "../src/utils/chilean-rut.js";
import { isolateBrowserNetwork } from "./isolated-network.js";

let sample;
test.beforeAll(async () => {
  requireAcademicIsolation();
  await seedAcademicData();
  sample = await seedAccountHistory();
});
test.beforeEach(async ({ context }) => {
  requireAcademicIsolation();
  await prisma.public_request_rate_limits.deleteMany();
  await isolateBrowserNetwork(context);
});
test.afterAll(async () => prisma.$disconnect());

async function data(response, status = 200) {
  const body = await response.json();
  expect(response.status(), body.error?.message).toBe(status);
  return body.data;
}

async function login(page) {
  await data(await page.request.post("/api/store/accounts/login", {
    data: { email: sample.owner.email, password: sample.password },
  }));
}

async function prepareCart(page) {
  await data(await page.request.post("/api/store/cart"), 201);
  return data(await page.request.post("/api/store/cart/items", {
    data: { items: [{ productId: sample.frame.id, quantity: 1 }] },
  }));
}

async function draftInStorage(page, cart, buyer) {
  await page.goto("/contacto");
  await page.evaluate(({ key, version, value }) => {
    sessionStorage.setItem(key, JSON.stringify({ version, buyer: value }));
  }, { key: cartDraftKey(cart.id), version: cart.externalPrescription?.updatedAt ?? null, value: buyer });
}

function buyerField(page, field) {
  return page.locator(`form.buyer-form [name="${field}"]`);
}

async function expectAccountContact(page) {
  const { patient, email } = sample.owner;
  for (const [field, value] of Object.entries({
    address: patient.address, email, firstNames: patient.first_names, lastNames: patient.last_names,
    phone: patient.phone, rut: formatChileanRut(patient.rut),
  })) {
    await expect(buyerField(page, field)).toHaveValue(value);
  }
}

async function checkout(page) {
  const pickup = buyerField(page, "branchId");
  const branch = await pickup.locator('option[value]:not([value=""]):not([disabled])').first().getAttribute("value");
  await pickup.selectOption(branch);
  const [response] = await Promise.all([
    page.waitForResponse((result) => result.url().endsWith("/api/store/cart/checkout") && result.request().method() === "POST"),
    page.getByRole("button", { name: "Continuar a Mercado Pago" }).click(),
  ]);
  const result = await data(response, 201);
  expect(result.paymentError.code).toBe("PAYMENT_PROVIDER_NOT_CONFIGURED");
  return result.order;
}

test("Carrito nuevo autenticado muestra los datos de la cuenta", async ({ page }) => {
  await login(page);
  await prepareCart(page);
  await page.goto("/carrito");
  await expectAccountContact(page);
});

test("Mi carrito completa los datos de un borrador que contiene respuestas vacías", async ({ page }) => {
  await login(page);
  const cart = await prepareCart(page);
  await draftInStorage(page, cart, { address: "", email: "", firstNames: " ", lastNames: "", phone: "", rut: "" });
  await page.goto("/cuenta?seccion=carrito");
  await expectAccountContact(page);
});

test("Un correo válido del borrador prevalece y se completa el resto del contacto", async ({ page }) => {
  await login(page);
  const cart = await prepareCart(page);
  await draftInStorage(page, cart, { email: "alternativo@example.invalid", phone: "" });
  await page.goto("/carrito");
  await expect(buyerField(page, "email")).toHaveValue("alternativo@example.invalid");
  await expect(buyerField(page, "phone")).toHaveValue(sample.owner.patient.phone);
  await page.reload();
  await expect(buyerField(page, "email")).toHaveValue("alternativo@example.invalid");
});

test("Iniciar sesión conserva los productos y las ediciones del carrito invitado", async ({ page }) => {
  const cart = await prepareCart(page);
  await page.goto("/carrito");
  await buyerField(page, "notes").fill("Retiro sintético");
  await buyerField(page, "phone").fill("+56987654321");

  await page.goto("/cuenta");
  const form = page.locator("main form");
  await form.getByLabel("Correo electrónico", { exact: true }).fill(sample.owner.email);
  await form.getByLabel("Contraseña", { exact: true }).fill(sample.password);
  await form.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Navegación de mi cuenta" })).toBeVisible();
  await page.goto("/carrito");
  const restored = await data(await page.request.get("/api/store/cart"));
  expect(restored.id).toBe(cart.id);
  expect(restored.items).toHaveLength(1);
  await expect(buyerField(page, "email")).toHaveValue(sample.owner.email);
  await expect(buyerField(page, "phone")).toHaveValue("+56987654321");
  await expect(buyerField(page, "notes")).toHaveValue("Retiro sintético");
});

test("El perfil que llega tarde completa campos sin sobrescribir la edición del comprador", async ({ page }) => {
  await login(page);
  await prepareCart(page);
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch;
    const ready = new Promise((resolve) => window.addEventListener("perfil-de-prueba", resolve, { once: true }));
    window.fetch = async (resource, options) => {
      const request = fetchOriginal(resource, options);
      const url = new URL(resource instanceof Request ? resource.url : resource, location.href);
      if (url.pathname === "/api/store/accounts/me") await ready;
      return request;
    };
  });
  await page.goto("/carrito");
  await buyerField(page, "email").fill("editado@example.invalid");
  await buyerField(page, "address").fill("Dirección de retiro sintética");
  await page.evaluate(() => window.dispatchEvent(new Event("perfil-de-prueba")));
  await expect(buyerField(page, "phone")).toHaveValue(sample.owner.patient.phone);
  await expect(buyerField(page, "email")).toHaveValue("editado@example.invalid");
  await expect(buyerField(page, "address")).toHaveValue("Dirección de retiro sintética");
  await buyerField(page, "email").clear();
  await expect(buyerField(page, "email")).toHaveValue("");
  await expect(buyerField(page, "email")).toHaveJSProperty("required", true);
  await buyerField(page, "email").fill("editado@example.invalid");
});

test("El contacto editado se conserva al recargar y regresar al carrito", async ({ page }) => {
  await login(page);
  await prepareCart(page);
  await page.goto("/carrito");
  await buyerField(page, "firstNames").fill("Comprador sintético");
  await buyerField(page, "notes").fill("Conservar instrucción de retiro");
  await page.reload();
  await expect(buyerField(page, "firstNames")).toHaveValue("Comprador sintético");
  await expect(buyerField(page, "notes")).toHaveValue("Conservar instrucción de retiro");
  await page.goto("/tienda");
  await page.goBack();
  await expect(buyerField(page, "email")).toHaveValue(sample.owner.email);
  await expect(buyerField(page, "firstNames")).toHaveValue("Comprador sintético");
  await expect(buyerField(page, "notes")).toHaveValue("Conservar instrucción de retiro");
});

test("La compra con correo precargado valida el formato y aparece en Mis pedidos", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await prepareCart(page);
  await page.goto("/carrito");
  await expectAccountContact(page);
  const email = buyerField(page, "email");
  await email.fill("correo-invalido");
  expect(await email.evaluate((input) => input.validity.typeMismatch)).toBe(true);
  await email.fill(sample.owner.email);

  const order = await checkout(page);
  await page.goto("/cuenta?seccion=pedidos");
  const row = page.locator(".order-row").filter({ hasText: "Pedido N.º " + order.saleNumber });
  await row.getByRole("link", { name: /Ver pedido/ }).click();
  await expect(page.getByRole("link", { name: /Volver a Mis pedidos/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp("pedido=" + order.id));
});

test("El invitado conserva su contacto ingresado y puede completar el checkout", async ({ page }) => {
  await prepareCart(page);
  await page.goto("/carrito");
  await expect(buyerField(page, "email")).toHaveValue("");
  for (const [field, value] of Object.entries({
    address: "Calle sintética", email: "invitado@example.invalid", firstNames: "Invitado",
    lastNames: "Sintético", phone: "+56922334455", rut: "12345678-5",
  })) {
    await buyerField(page, field).fill(value);
  }
  await page.reload();
  await expect(buyerField(page, "email")).toHaveValue("invitado@example.invalid");
  const order = await checkout(page);
  expect(order.customer.email).toBe("invitado@example.invalid");
  await expect(page).toHaveURL(/\/checkout\/mercado-pago\/pending\?orderId=/);
});
