import { expect, test } from "@playwright/test";

const profile = {
  id: "20000000-0000-4000-8000-000000000087",
  firstNames: "Cliente", lastNames: "Sintético", email: "portal@example.invalid",
  rut: "20000087-6", address: "Dirección sintética", phone: "+56912345678",
};
const recipeId = "20000000-0000-4000-8000-000000000088";
const orderId = "20000000-0000-4000-8000-000000000089";
const eye = { sphere: -1.25, cylinder: -0.50, axis: 90, addition: null };
const patient = { firstNames: "Paciente", lastNames: "Sintético", rutMasked: "•••••87-6" };
const order = {
  id: orderId, saleNumber: 412, status: "PENDING",
  createdAt: "2026-11-10T12:00:00.000Z", items: [{ quantity: 1, name: "Cristal sintético" }],
  totalCents: 20000, balanceCents: 12000, paidCents: 8000,
};
const cart = {
  id: "20000000-0000-4000-8000-000000000090", status: "ACTIVE", subtotalCents: 20000,
  items: [{ productId: "20000000-0000-4000-8000-000000000091", name: "Cristal sintético", category: "PRESCRIPTION_LENS", requiresPrescription: true, quantity: 1, unitPriceCents: 20000, lineTotalCents: 20000 }],
};
const ok = (route, data) => route.fulfill({ json: { success: true, data } });
const fail = (route, message) => route.fulfill({ status: 503, json: { success: false, error: { message } } });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/store/accounts/me", (route) => ok(route, profile));
  await page.route("**/api/store/accounts/me/contact", (route) => ok(route, { channels: [] }));
  await page.route(/\/api\/store\/accounts\/me\/prescriptions(?:\?|$)/, (route) => ok(route, []));
});

test("Mi carrito abre un carrito vacío después de una compra terminada", async ({ page }) => {
  await page.route("**/api/store/orders?*", (route) => ok(route, { items: [], page: 1, totalPages: 0 }));
  await page.route("**/api/store/accounts/me/clinical", (route) => ok(route, { linked: false }));
  let created = 0;
  await page.route("**/api/store/cart", (route) => {
    if (route.request().method() === "POST") {
      created++;
      return ok(route, { ...cart, id: "nuevo-carrito", items: [] });
    }
    return ok(route, { ...cart, status: "CHECKED_OUT", saleId: orderId });
  });
  await page.goto("/cuenta?seccion=carrito");
  await expect(page.getByRole("heading", { name: "Tu carrito está vacío", exact: true })).toBeVisible();
  expect(created).toBe(1);
  await expect(page.getByText("Tu pedido ya fue creado", { exact: true })).toHaveCount(0);
});

test("Mis recetas lee con OpenAI y permite corregir valores antes de guardarlos sin ficha clínica", async ({ page }) => {
  await page.route("**/api/store/orders?*", (route) => ok(route, { items: [], page: 1, totalPages: 0 }));
  await page.route("**/api/store/accounts/me/clinical", (route) => ok(route, { linked: false }));
  const saved = { id: recipeId, filename: "receta-prueba.png", createdAt: "2026-11-15T12:00:00Z", imageHash: "a".repeat(64), status: "DRAFT" };
  await page.route("**/api/store/accounts/me/prescriptions", (route) => ok(route, route.request().method() === "POST" ? saved : []));
  await page.route("**/api/store/accounts/me/prescriptions/" + recipeId + "/read", (route) => ok(route, {
    ...saved, extractionStatus: "COMPLETED", extractedData: { leftEye: eye, rightEye: eye, pupillaryDistance: 62, warnings: [], confidence: "HIGH" },
  }));
  let confirmed;
  await page.route("**/api/store/accounts/me/prescriptions/" + recipeId, async (route) => {
    confirmed = route.request().postDataJSON();
    await ok(route, { ...saved, status: "READY", confirmedData: confirmed });
  });
  await page.goto("/cuenta?seccion=recetas");
  await page.getByLabel("Archivo de la receta").setInputFiles({ name: "receta-prueba.png", mimeType: "image/png", buffer: Buffer.from("receta-sintetica") });
  await page.getByRole("button", { name: "Subir y leer receta", exact: true }).click();
  const right = page.getByRole("group", { name: "Ojo derecho", exact: true });
  await expect(right.getByLabel("Esfera", { exact: true })).toHaveValue("-1.25");
  await right.getByLabel("Esfera", { exact: true }).fill("-2.25");
  await page.getByRole("button", { name: "Confirmar y guardar receta", exact: true }).click();
  await expect(page.getByText("Revisada y guardada", { exact: false })).toBeVisible();
  expect(confirmed.rightEye.sphere).toBe(-2.25);
  expect(confirmed.imageHash).toBe(saved.imageHash);
  await expect(page.getByRole("button", { name: "Usar en mi carrito", exact: true })).toBeVisible();
});

test("Menores a mi cargo mantiene separados los datos y las recetas del adulto", async ({ page }) => {
  const dependantId = "20000000-0000-4000-8000-000000000099";
  await page.route("**/api/store/orders?*", (route) => ok(route, { items: [], page: 1, totalPages: 0 }));
  await page.route("**/api/store/accounts/me/clinical", (route) => ok(route, { linked: false }));
  await page.route("**/api/store/accounts/me/dependants", (route) => ok(route, [{
    id: dependantId, firstNames: "Hijo", lastNames: "Sintético", birthDate: "2015-05-10", rut: "20000087-6", relationship: "Padre", isMinor: true, linked: true,
  }]));
  await page.route("**/api/store/accounts/me/clinical?dependantId=" + dependantId, (route) => ok(route, {
    linked: true, patient: { firstNames: "Hijo", lastNames: "Sintético" }, upcomingAppointments: [], appointmentHistory: [], prescriptions: { active: [], history: [] },
    encounters: [{ id: "atencion", date: "2026-11-10", type: "OPTOMETRY", reason: "Control visual del menor" }],
  }));
  await page.goto("/cuenta?seccion=menores");
  await page.getByRole("link", { name: "Ver datos, recetas y atenciones", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hijo Sintético", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recetas de Hijo", exact: true })).toBeVisible();
  await expect(page.getByText("Control visual del menor", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("reserva y carrito conservan el panel y una receta de la cuenta llega al carrito", async ({ page }) => {
  await page.route("**/api/store/orders?*", (route) => ok(route, { items: [order], page: 1, totalPages: 1 }));
  await page.route("**/api/store/accounts/me/clinical", (route) => ok(route, {
    linked: true, patient, upcomingAppointments: [], appointmentHistory: [],
    prescriptions: { active: [{ id: recipeId, issuedAt: "2026-11-10T12:00:00.000Z", rightEye: eye, leftEye: eye, pupillaryDistance: 62 }], history: [] },
  }));
  await page.route("**/api/store/cart", (route) => ok(route, cart));
  await page.route("**/api/store/booking/professionals", (route) => ok(route, []));
  await page.route("**/api/store/orders/" + orderId + "?scope=account", (route) => ok(route, order));
  await page.route("**/api/store/cart/prescription/clinical", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postDataJSON()).toEqual({ prescriptionId: recipeId, replaceExisting: false });
    await ok(route, { ...cart, clinicalPrescriptionId: recipeId });
  });
  await page.goto("/cuenta");
  const menu = page.getByRole("navigation", { name: "Navegación de mi cuenta" });
  await menu.getByRole("link", { name: "Mis recetas" }).click();
  await page.locator("#recetas summary").click();
  await expect(page.getByRole("link", { name: "Descargar PDF" })).toHaveAttribute("href", new RegExp(recipeId + "/pdf$"));
  await page.getByRole("button", { name: "Usar en mi carrito" }).click();
  await expect(menu.getByRole("link", { name: "Mi carrito" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("combobox", { name: "Receta clínica vigente" })).toHaveValue(recipeId);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Receta clínica vigente" })).toHaveValue(recipeId);
  await page.getByRole("button", { name: "Usar esta receta" }).click();
  await expect(page.getByText("Estás usando una receta de tu cuenta.")).toBeVisible();

  await menu.getByRole("link", { name: "Reservar hora" }).click();
  await expect(page.getByRole("heading", { name: "Elige profesional y fecha" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Reservar hora" })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(menu.getByRole("link", { name: "Reservar hora" })).toHaveAttribute("aria-current", "page");

  await menu.getByRole("link", { name: "Mis pedidos" }).click();
  await page.getByRole("link", { name: "Ver pedido y pagar" }).click();
  await expect(page.getByRole("heading", { name: "Pedido N.º 412" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar saldo pendiente" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Mis pedidos" })).toHaveAttribute("aria-current", "page");
});

test("una ficha caída y un cierre fallido dejan abierta la cuenta con un mensaje", async ({ page }) => {
  await page.route("**/api/store/orders?*", (route) => ok(route, { items: [order], page: 1, totalPages: 1 }));
  await page.route("**/api/store/accounts/me/clinical", (route) => fail(route, "Ficha temporalmente no disponible."));
  await page.route("**/api/store/accounts/logout", (route) => fail(route, "Sesión temporalmente no disponible."));
  await page.goto("/cuenta");
  await expect(page.getByRole("heading", { name: "Hola, Cliente" })).toBeVisible();
  await expect(page.getByText("Ficha temporalmente no disponible.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver pedido y pagar" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page.getByText(/No pudimos cerrar tu sesión/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hola, Cliente" })).toBeVisible();
});

test("un fallo al actualizar pedidos oculta el estado vacío anterior", async ({ page }) => {
  let linked = false;
  await page.route("**/api/store/accounts/me/clinical", (route) => ok(route, { linked: false }));
  await page.route("**/api/store/orders?*", (route) => linked
    ? fail(route, "No pudimos actualizar tus pedidos.")
    : ok(route, { items: [], page: 1, totalPages: 0 }));
  await page.route("**/api/store/accounts/me/orders-link/request-code", (route) => ok(route, { challengeId: "fixture", message: "Consulta el correo de la compra." }));
  await page.route("**/api/store/accounts/me/orders-link", (route) => {
    linked = true;
    return ok(route, { linked: true });
  });
  await page.goto("/cuenta?seccion=pedidos");
  await expect(page.getByRole("heading", { name: "Aún no tienes pedidos" })).toBeVisible();
  await page.getByText("Recuperar una compra anterior como invitado", { exact: true }).click();
  await page.getByRole("textbox", { name: "Número del pedido anterior" }).fill("42");
  await page.getByRole("button", { name: "Solicitar código del pedido" }).click();
  await page.getByRole("textbox", { name: "Código del pedido anterior" }).fill("123456");
  await page.getByRole("button", { name: "Confirmar recuperación" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos actualizar tus pedidos." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aún no tienes pedidos" })).toHaveCount(0);
});

test("el retorno sin marcador ofrece abrir el pedido únicamente a su cuenta", async ({ page }) => {
  let owned = true;
  await page.route("**/api/store/orders/" + orderId + "?scope=account", (route) => owned
    ? ok(route, order)
    : route.fulfill({ status: 404, json: { success: false } }));
  await page.route("**/api/store/orders/" + orderId, (route) => ok(route, { ...order, status: "PAID" }));
  await page.route("**/api/store/orders?*", (route) => ok(route, { items: [order], page: 1, totalPages: 1 }));
  await page.route("**/api/store/accounts/me/clinical", (route) => ok(route, { linked: false }));
  const returnPath = "/checkout/mercado-pago/success?orderId=" + orderId;
  await page.goto(returnPath);
  await page.getByRole("link", { name: "Abrir pedido en Mi cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Pedido N.º 412" })).toBeVisible();

  owned = false;
  await page.goto(returnPath);
  await expect(page.getByRole("heading", { name: "Pago confirmado" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver mi pedido", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir pedido en Mi cuenta" })).toHaveCount(0);
});
