import { createHash, randomUUID } from "node:crypto";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { shippingConfiguration } from "../src/config/shipping.js";
import { quoteCart, quoteSnapshot, saveShippingQuotes } from "../src/repositories/shipping-repository.js";
import { prisma } from "../src/db/prisma.js";
import {
  createAppointment as createAppointmentRepository, createPublicBooking as createPublicBookingRepository,
  updateAppointment as updateAppointmentRepository, updateCustomerAppointment,
} from "../src/repositories/appointment-repository.js";
import { actorFor, seedAcademicData, requireAcademicIsolation } from "../tests/fixtures/academic-data.js";
import { fixtureRut } from "../tests/fixtures/management-data.js";
import { seedBranchIsolation } from "../tests/fixtures/branch-isolation-data.js";
import { isolateBrowserNetwork } from "./isolated-network.js";

let sample, globalPassword;

test.beforeAll(async () => {
  requireAcademicIsolation();
  await seedAcademicData();
  sample = await seedBranchIsolation();
  ({ password: globalPassword } = JSON.parse(await readFile("tmp/academic-validation/demo-credentials.json", "utf8")));
});
test.afterAll(() => prisma.$disconnect());
test.beforeEach(async ({ context }) => {
  await prisma.public_request_rate_limits.deleteMany();
  await isolateBrowserNetwork(context);
});

async function body(response, expected = 200) {
  const payload = await response.json();
  expect(response.status(), response.url() + " " + (payload.error?.code ?? "")).toBe(expected);
  expect(payload.success).toBe(true);
  return payload.data;
}

async function blocked(response) {
  const payload = await response.json();
  expect([403, 404], response.url() + " " + (payload.error?.code ?? "")).toContain(response.status());
  expect(payload.success).toBe(false);
}

async function login(context, staff) {
  const data = staff
    ? { email: staff.email, password: sample.password }
    : { email: "academic-administrador@example.invalid", password: globalPassword };
  await body(await context.request.post("/api/auth/login", { data }));
  return context.request;
}

async function extraContext(browser) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await isolateBrowserNetwork(context);
  return context;
}

function selectBranch(request, branchId) {
  return request.patch("/api/auth/me", { data: { branchId } });
}

test("separar ventas, clientes, pacientes, caja, usuarios y reportes en tres sucursales", async ({ context, browser }) => {
  const other = await extraContext(browser);
  const general = await extraContext(browser);
  try {
    const a = await login(context, sample.adminA);
    const b = await login(other, sample.adminB);
    const global = await login(general);
    const { romano, palet, barros, saleA, saleB, saleLegacy, customerA, customerB, patientAB, patientB, cashB } = sample;
    expect((await body(await a.get("/api/auth/me"))).branches.map((item) => item.id)).toEqual([romano.id]);
    expect((await body(await global.get("/api/auth/me"))).branches.map((item) => item.id)).toEqual(expect.arrayContaining([romano.id, palet.id, barros.id]));
    await blocked(await selectBranch(a, palet.id));
    await body(await selectBranch(a, romano.id));
    await body(await a.get("/api/sales/" + saleA));
    await blocked(await a.get("/api/sales/" + saleB));
    await blocked(await a.get("/api/sales/" + saleLegacy));
    await blocked(await b.get("/api/sales/" + saleA));
    await body(await b.get("/api/sales/" + saleB));
    await body(await global.get("/api/sales/" + saleLegacy));
    await blocked(await a.get("/api/sales/" + saleB + "/history"));
    await blocked(await a.get("/api/sales/" + saleB + "/receipt/print"));
    await blocked(await a.patch("/api/sales/" + saleB, { data: { branchId: romano.id, items: [{ productId: saleB, quantity: 1 }] } }));
    await blocked(await a.get("/api/customers/" + customerB));
    await blocked(await a.get("/api/customers/" + customerB + "/profile"));
    await blocked(await a.patch("/api/customers/" + customerB, { data: { firstNames: "Edición sintética" } }));
    await body(await a.get("/api/customers/" + customerA));
    await body(await b.get("/api/customers/" + customerA));
    await blocked(await a.get("/api/patients/" + patientB));
    await body(await a.get("/api/patients/" + patientAB));
    await body(await b.get("/api/patients/" + patientB));
    await blocked(await a.get("/api/cash-register/" + cashB));
    await blocked(await a.get("/api/cash-register?history=true&consolidated=true"));
    await body(await b.get("/api/cash-register/" + cashB));
    await blocked(await a.get("/api/users/" + sample.adminB.id));
    await blocked(await a.post("/api/inventory/branches", { data: { action: "ASSIGN", branchId: palet.id, userId: sample.adminA.id } }));
    await blocked(await a.post("/api/users", { data: { branchId: romano.id, email: "elevacion@example.invalid",
      firstName: "Usuario", lastName: "Sintético", password: sample.password, roles: ["ADMIN"] } }));
    await blocked(await a.get("/api/reports/sales?branchId=" + palet.id));
    const reportA = await body(await a.get("/api/reports/sales"));
    const reportB = await body(await b.get("/api/reports/sales"));
    const consolidated = await body(await global.get("/api/reports/sales"));
    expect(reportA.summary.totalCents).toBe(3100);
    expect(reportB.summary.totalCents).toBe(6300);
    expect(consolidated.summary.totalCents).toBeGreaterThanOrEqual(18300);
    const reports = await context.newPage();
    await reports.goto("/app/reportes");
    const exportResult = reports.waitForEvent("download");
    await reports.getByRole("button", { name: "Exportar productos CSV" }).click();
    const csv = await readFile(await (await exportResult).path(), "utf8");
    expect(csv).toContain(sample.skuA);
    expect(csv).not.toContain(sample.skuB);
  } finally {
    await Promise.all([other.close(), general.close()]);
  }
});

test("mostrar sucursales autorizadas en el navegador y revocar una sesión activa", async ({ page }) => {
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico", { exact: true }).fill(sample.sales.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(sample.password);
  await page.getByRole("button", { name: "Ingresar de forma segura" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const selector = page.getByRole("combobox", { name: "Sucursal activa" });
  await expect(selector).toBeVisible();
  await expect(selector.getByRole("option")).toHaveCount(3);
  await expect(selector.getByRole("option", { name: sample.palet.name })).toHaveCount(0);
  await selector.selectOption(sample.barros.id);
  await expect.poll(async () => (await body(await page.request.get("/api/auth/me"))).activeBranchId).toBe(sample.barros.id);
  await prisma.user_branches.delete({ where: { user_id_branch_id: { user_id: sample.sales.id, branch_id: sample.barros.id } } });
  expect((await body(await page.request.get("/api/auth/me"))).activeBranchId).toBeNull();
  await blocked(await selectBranch(page.request, sample.barros.id));
  await blocked(await page.request.get("/api/inventory?branchId=" + sample.barros.id));
});

test("separar agenda, atención e impresión clínica del mismo paciente por sucursal", async ({ context, browser }) => {
  const two = await extraContext(browser);
  const general = await extraContext(browser);
  try {
    const a = await login(context, sample.doctorA);
    const ab = await login(two, sample.doctorAB);
    const global = await login(general);
    const { romano, palet, patientAB, appointmentA, appointmentB, encounterA, encounterB } = sample;
    await body(await a.get("/api/appointments/" + appointmentA.id));
    await blocked(await a.get("/api/appointments/" + appointmentB.id));
    await body(await ab.get("/api/appointments/" + appointmentB.id));
    await blocked(await a.get("/api/professionals/" + sample.doctorA.id + "/schedule?branchId=" + palet.id));
    await blocked(await a.get("/api/clinical-encounters/" + encounterB.id));
    await blocked(await a.get("/api/clinical-encounters/" + encounterB.id + "/print"));
    await blocked(await global.get("/api/clinical-encounters/" + encounterA.id));
    await body(await a.get("/api/clinical-encounters/" + encounterA.id));
    await body(await ab.get("/api/clinical-encounters/" + encounterB.id));
    await blocked(await a.patch("/api/clinical-encounters/" + encounterB.id, { data: { expectedVersion: 1, reasonForVisit: "Edición sintética" } }));
    const path = "/api/patients/" + patientAB + "/clinical-history?branchId=";
    const historyA = JSON.stringify(await body(await ab.get(path + romano.id)));
    const historyB = JSON.stringify(await body(await ab.get(path + palet.id)));
    expect(historyA).toContain(encounterA.id);
    expect(historyA).not.toContain(encounterB.id);
    expect(historyB).toContain(encounterB.id);
    expect(historyB).not.toContain(encounterA.id);
  } finally {
    await Promise.all([two.close(), general.close()]);
  }
});

test("reservar stock solo en Romano para un retiro web concurrente y proteger el pedido", async ({ context, browser }) => {
  const buyer2 = await extraContext(browser);
  const other = await extraContext(browser);
  const allowed = await extraContext(browser);
  const general = await extraContext(browser);
  try {
    const productId = randomUUID(), { romano, palet } = sample;
    await prisma.products.create({ data: { id: productId, sku: "REC-" + productId.slice(0, 8).toUpperCase(), name: "Marco sintético",
      category: "FRAME", unit_price_cents: 49000, inventory_mode: "TRACKED", requires_prescription: false, is_test_data: true, created_by: sample.adminA.id, updated_by: sample.adminA.id } });
    const romanStaff = await login(allowed, sample.adminA);
    const paletStaff = await login(other, sample.adminB);
    for (const [operator, location, quantity] of [[romanStaff, romano, 1], [paletStaff, palet, 5]]) {
      const response = await operator.post("/api/inventory", { headers: { "X-Idempotency-Key": randomUUID() },
        data: { kind: "COUNT", branchId: location.id, productId, quantity, reason: "Stock sintético para retiro" } });
      await body(response, response.status() === 201 ? 201 : 200);
    }
    async function prepare(request, email, rut) {
      await body(await request.post("/api/store/accounts/login", { data: { email, password: sample.password } }));
      await body(await request.post("/api/store/cart"), 201);
      await body(await request.post("/api/store/cart/items", { data: { items: [{ productId, quantity: 1 }] } }));
      await body(await request.patch("/api/store/cart", { data: { buyer: { rut, email,
        firstNames: "Comprador", lastNames: "Sintético", address: "Dirección de ensayo", phone: "+56912345678" },
      fulfillment: { method: "PICKUP", branchId: romano.id } } }));
    }
    await prepare(context.request, sample.buyerEmail, sample.buyerRut);
    await prepare(buyer2.request, sample.otherBuyer.email, sample.otherBuyer.rut);
    const responses = await Promise.all([context.request, buyer2.request].map((request) => request.post("/api/store/cart/checkout")));
    expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
    const { order } = await body(responses.find((response) => response.status() === 201), 201);
    const sale = await prisma.sales.findUniqueOrThrow({ where: { id: order.id } });
    expect(sale.branch_id).toBe(romano.id);
    const rows = await prisma.inventory_stocks.findMany({ where: { product_id: productId } });
    expect(rows.find((row) => row.branch_id === romano.id)).toMatchObject({ on_hand: 1, reserved: 1 });
    expect(rows.find((row) => row.branch_id === palet.id)).toMatchObject({ on_hand: 5, reserved: 0 });
    const [winner, otherBuyer] = responses[0].status() === 201 ? [context.request, buyer2.request] : [buyer2.request, context.request];
    await body(await winner.get("/api/store/orders/" + order.id));
    await blocked(await otherBuyer.get("/api/store/orders/" + order.id));
    await body(await romanStaff.get("/api/sales/" + order.id));
    await blocked(await paletStaff.get("/api/sales/" + order.id));
    await body(await (await login(general)).get("/api/sales/" + order.id));
  } finally {
    await Promise.all([buyer2.close(), other.close(), allowed.close(), general.close()]);
  }
});

test("asignar un despacho al origen de la cotización y mantener privado su seguimiento", async ({ context, browser }) => {
  test.skip(process.env.CHILEXPRESS_MODE !== "test", "Requiere el modo logístico de pruebas en PostgreSQL aislado.");
  const owner = await extraContext(browser);
  const remote = await extraContext(browser);
  const local = await extraContext(browser);
  const { romano, palet, barros } = sample;
  try {
    const origin = { validated: true, countyCode: "SYN", street: "Calle ficticia", number: "100",
      name: "Remitente sintético", email: "bodega@example.invalid", phone: "+56912345678", contentType: 5 };
    const packaging = { code: "PACK-" + randomUUID().slice(0, 8).toUpperCase(), validated: true, tare_weight_kg: 0.1,
      height_cm: 20, width_cm: 15, length_cm: 20, max_units: 4 };
    await prisma.shipping_packaging.create({ data: packaging });
    await prisma.branches.update({ where: { id: barros.id }, data: { shipping_enabled: true, shipping_origin: origin } });
    const productId = randomUUID(), lensId = randomUUID();
    const logistics = { validated: true, packagingCode: packaging.code, weightKg: 0.2, heightCm: 3, widthCm: 8, lengthCm: 12 };
    await prisma.products.create({ data: { id: lensId, sku: "LEN-" + lensId.slice(0, 8).toUpperCase(), name: "Cristal de despacho sintético",
      category: "PRESCRIPTION_LENS", unit_price_cents: 23000, inventory_mode: "ON_DEMAND", requires_prescription: true,
      is_test_data: true, created_by: sample.adminA.id, updated_by: sample.adminA.id, shipping_logistics: logistics } });
    await prisma.products.create({ data: { id: productId, sku: "DSP-" + productId.slice(0, 8).toUpperCase(), name: "Marco de despacho sintético",
      category: "FRAME", unit_price_cents: 41000, inventory_mode: "TRACKED", requires_prescription: false,
      is_test_data: true, created_by: sample.adminA.id, updated_by: sample.adminA.id,
      shipping_logistics: logistics } });
    const locations = [[sample.adminA, romano], [sample.adminB, palet], [sample.sales, barros]];
    for (const [staff, site] of locations) {
      const session = await extraContext(browser);
      try {
        if (staff.id === sample.sales.id) {
          await prisma.user_branches.upsert({ where: { user_id_branch_id: { user_id: staff.id, branch_id: site.id } }, update: {},
            create: { user_id: staff.id, branch_id: site.id } });
        }
        const operator = await login(session, staff);
        await body(await operator.post("/api/inventory", { headers: { "X-Idempotency-Key": randomUUID() },
          data: { kind: "COUNT", branchId: site.id, productId, quantity: 2, reason: "Stock sintético para despacho" } }));
      } finally {
        await session.close();
      }
    }
    const buyer = { rut: sample.buyerRut, email: sample.buyerEmail, firstNames: "Comprador", lastNames: "Sintético",
      address: "Dirección de ensayo", phone: "+56912345678" };
    await body(await owner.request.post("/api/store/accounts/login", { data: { email: buyer.email, password: sample.password } }));
    const cart = await body(await owner.request.post("/api/store/cart"), 201);
    for (const item of cart.items) await body(await owner.request.delete("/api/store/cart/items/" + item.productId));
    await body(await owner.request.post("/api/store/cart/items", { data: { items: [
      { productId, quantity: 1 }, { productId: lensId, mountFrameProductId: productId, quantity: 1 },
    ] } }));
    const prescription = await prisma.optical_prescriptions.create({ data: { encounter_id: sample.encounterB.id,
      issued_by: sample.doctorAB.id, version: 1, right_sphere: -1, right_cylinder: 0, left_sphere: -1, left_cylinder: 0 } });
    await body(await owner.request.put("/api/store/cart/prescription/clinical", { data: { prescriptionId: prescription.id } }));
    const destination = { countyCode: "DST", regionCode: "SYN", countyName: "Comuna ficticia", regionName: "Región ficticia",
      street: "Calle de ensayo", number: "12", supplement: "", addressId: 0 };
    const snapshot = await quoteSnapshot(prisma, await quoteCart(prisma, cart.id), destination);
    expect(snapshot.branchId).toBe(barros.id);
    // Simular la tarifa del transportista. El cálculo, la huella, la caducidad y la reserva son los flujos reales.
    const [quote] = await saveShippingQuotes(cart.id, snapshot, [{ serviceCode: "99", service: "Envío sintético", providerCost: 3100, conditions: "Prueba" }], shippingConfiguration());
    await body(await owner.request.patch("/api/store/cart", { data: { buyer, clinicalPrescriptionId: prescription.id,
      fulfillment: { method: "DELIVERY", quoteId: quote.id, branchId: palet.id } } }));
    const { order } = await body(await owner.request.post("/api/store/cart/checkout"), 201);
    const sale = await prisma.sales.findUniqueOrThrow({ where: { id: order.id } });
    expect(sale).toMatchObject({ branch_id: barros.id, shipping_quote_id: quote.id, fulfillment_method: "DELIVERY" });
    const stocks = await prisma.inventory_stocks.findMany({ where: { product_id: productId } });
    expect(stocks.filter((row) => row.reserved === 1).map((row) => row.branch_id)).toEqual([barros.id]);
    await body(await owner.request.get("/api/store/orders/" + order.id + "/shipment"));
    const barrosStaff = await login(local, sample.sales);
    await body(await barrosStaff.get("/api/sales/" + order.id + "/shipment"));
    const optical = await body(await barrosStaff.get("/api/sales/" + order.id + "/prescription"));
    expect(optical).toMatchObject({ id: prescription.id, rightEye: { sphere: -1 } });
    expect(optical).not.toHaveProperty("encounterId");
    await blocked(await barrosStaff.get("/api/prescriptions/" + prescription.id));
    const paletStaff = await login(remote, sample.adminB);
    await blocked(await paletStaff.get("/api/sales/" + order.id + "/shipment"));
    await blocked(await paletStaff.get("/api/sales/" + order.id + "/shipment/label"));
    await blocked(await paletStaff.get("/api/sales/" + order.id + "/prescription"));
    await blocked(await context.request.get("/api/store/orders/" + order.id + "/shipment"));
  } finally {
    await Promise.all([owner.close(), remote.close(), local.close()]);
  }
});

test("limitar transferencia a origen y destino y excluir su contenido de la tercera sucursal", async ({ context, browser }) => {
  const to = await extraContext(browser);
  const third = await extraContext(browser);
  const { romano, palet, barros } = sample;
  try {
    const source = await login(context, sample.adminA);
    const destination = await login(to, sample.adminB);
    const thirdParty = await login(third, sample.salesBarros);
    const productId = randomUUID();
    await prisma.products.create({ data: { id: productId, sku: "TR-" + productId.slice(0, 8).toUpperCase(),
      name: "Producto sintético para transferencia", category: "ACCESSORY", inventory_mode: "TRACKED",
      unit_price_cents: 5000, is_test_data: true, created_by: sample.adminA.id, updated_by: sample.adminA.id } });
    for (const [operator, site, quantity] of [[source, romano, 3], [destination, palet, 0]]) {
      await body(await operator.post("/api/inventory", { headers: { "X-Idempotency-Key": randomUUID() },
        data: { kind: "COUNT", branchId: site.id, productId, quantity, reason: "Conteo sintético" } }));
    }
    const data = { branchId: romano.id, destinationId: palet.id, productId, quantity: 1, reason: "Traslado sintético" };
    const response = await body(await source.post("/api/inventory/transfers", { headers: { "X-Idempotency-Key": randomUUID() }, data }));
    const url = "/api/inventory/transfers";
    const list = await body(await destination.get(url + "?branchId=" + palet.id));
    const visible = list.items.find((item) => item.id === response.id);
    expect(visible.source).toEqual({ id: romano.id, name: romano.name });
    expect(visible.destination).toEqual({ id: palet.id, name: palet.name });
    await blocked(await thirdParty.get(url + "?branchId=" + palet.id));
    const barrosList = await body(await thirdParty.get(url + "?branchId=" + barros.id));
    expect(barrosList.items.some((item) => item.id === response.id)).toBe(false);
    await blocked(await source.post(url, { data: { id: response.id, action: "RECEIVE" } }));
    await blocked(await destination.post(url, { data: { id: response.id, action: "CANCEL" } }));
    expect((await body(await destination.post(url, { data: { id: response.id, action: "RECEIVE" } }))).status).toBe("RECEIVED");
    const after = await prisma.inventory_stocks.findMany({ where: { product_id: productId } });
    expect(after.find((row) => row.branch_id === romano.id)?.on_hand).toBe(2);
    expect(after.find((row) => row.branch_id === palet.id)?.on_hand).toBe(1);
    expect(after.some((row) => row.branch_id === barros.id)).toBe(false);
  } finally {
    await Promise.all([to.close(), third.close()]);
  }
});

test.describe("Agenda por sede", () => {
  function agendaRequest(request) {
    const path = new URL(request.url()).pathname;
    return path === "/api/appointments" || /\/api\/professionals\/[^/]+\/(schedule|availability)/.test(path);
  }

  async function enter(page, staff, branch) {
    const request = await login(page.context(), staff);
    if (branch) await body(await selectBranch(request, branch.id));
    const observed = [];
    page.on("response", (response) => { if (agendaRequest(response.request())) observed.push(response); });
    await page.goto("/app/agenda");
    await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
    return observed;
  }

  function expectBranch(response, branch) {
    expect(new URL(response.url()).searchParams.get("branchId")).toBe(branch.id);
    expect(response.ok()).toBe(true);
  }

  test("ADMIN en vista general elige una sucursal antes de consultar horarios", async ({ page }) => {
    const observed = await enter(page);
    await expect(page.getByText(/Selecciona una sucursal en Sucursal activa/)).toBeVisible({ timeout: 4000 });
    await expect(page.getByRole("heading", { name: "Perfiles profesionales" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar horario" })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(observed).toHaveLength(0);
    const unscoped = await page.request.get("/api/professionals/" + sample.doctorAB.id + "/schedule");
    expect(unscoped.status()).toBe(400);
    expect((await unscoped.json()).error.code).toBe("BRANCH_REQUIRED");
    await page.getByRole("combobox", { name: "Sucursal activa" }).selectOption(sample.romano.id);
    await expect(page.getByRole("button", { name: "Guardar horario" })).toBeEnabled();
  });

  test("ADMIN en Romano carga su calendario y descarta una respuesta tardía al cambiar a Palet", async ({ page }) => {
    const { romano, palet, doctorAB, patientAB, patientB } = sample;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const hour = (value) => new Date(tomorrow + "T" + value + ":00Z");
    await prisma.appointments.createMany({ data: [
      { branch_id: romano.id, patient_id: patientAB, professional_id: doctorAB.id, start_at: hour("14:00"), end_at: hour("14:30") },
      { branch_id: palet.id, patient_id: patientB, professional_id: doctorAB.id, start_at: hour("15:00"), end_at: hour("15:30") },
    ] });
    await prisma.professional_weekly_schedules.updateMany({
      where: { professional_id: doctorAB.id, branch_id: palet.id },
      data: { start_time: new Date("1970-01-01T10:00:00Z") },
    });
    const observed = await enter(page, null, romano);
    const professional = page.locator(".agenda-toolbar select").first();
    await professional.selectOption(doctorAB.id);
    await expect(page.getByRole("button", { name: "Guardar horario" })).toBeEnabled();
    const schedule = () => observed.find((response) => new URL(response.url()).pathname.endsWith("/schedule"));
    await expect.poll(schedule).toBeDefined();
    expectBranch(schedule(), romano);
    for (const suffix of ["/blocks", "/appointments"]) {
      const reply = observed.find((response) => new URL(response.url()).pathname.endsWith(suffix));
      expectBranch(reply, romano);
    }
    await expect(page.getByLabel("Lunes inicio", { exact: true })).toHaveValue("09:00");
    const reservations = page.getByRole("region", { name: "Detalle de reservas" });
    await expect(reservations.getByText("Paciente compartido Sintético", { exact: true })).toBeVisible();
    await expect(reservations.getByText("Paciente solo Palet Sintético", { exact: true })).toHaveCount(0);
    const scheduledReads = (url) => url.pathname.endsWith("/schedule") && url.searchParams.get("branchId") === romano.id;
    let markPending, release;
    const pending = new Promise((resolve) => { markPending = resolve; });
    const resume = new Promise((resolve) => { release = resolve; });
    await page.route(scheduledReads, async (route) => {
      markPending();
      await resume;
      await route.fulfill({ status: 503, json: { success: false, error: { message: "Respuesta antigua de Romano" } } }).catch(() => {});
    }, { times: 1 });
    await page.getByRole("button", { name: "Actualizar", exact: true }).click();
    await pending;
    try {
      await page.getByRole("combobox", { name: "Sucursal activa" }).selectOption(palet.id);
      await expect(page.getByRole("button", { name: "Guardar horario" })).toBeEnabled();
      await expect(professional.locator("option")).toHaveCount(1);
      await expect(professional).toHaveValue(doctorAB.id);
      await expect(page.getByLabel("Lunes inicio", { exact: true })).toHaveValue("10:00");
      await expect(reservations.getByText("Paciente solo Palet Sintético", { exact: true })).toBeVisible();
      await expect(reservations.getByText("Paciente compartido Sintético", { exact: true })).toHaveCount(0);
    } finally {
      release();
    }
    await expect(page.getByText("Respuesta antigua de Romano")).toHaveCount(0);
    expectBranch(observed.find((response) => new URL(response.url()).pathname.endsWith("/schedule") &&
      new URL(response.url()).searchParams.get("branchId") === palet.id), palet);
  });

  test("BRANCH_ADMIN en Palet configura horario y bloqueos sin administrar perfiles generales", async ({ page }) => {
    const { palet, romano, adminB, doctorAB } = sample;
    const observed = await enter(page, adminB);
    await expect(page.getByRole("heading", { name: "Perfiles profesionales" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Crear perfil", exact: true })).toHaveCount(0);
    const save = page.getByRole("button", { name: "Guardar horario" });
    await expect(save).toBeEnabled();
    expectBranch(observed.find((response) => new URL(response.url()).pathname.endsWith("/schedule")), palet);
    const monday = page.getByLabel("Lunes inicio", { exact: true });
    await monday.fill("10:20");
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname.endsWith("/schedule"));
    await save.click();
    const savedResponse = await saved;
    expect(savedResponse.ok()).toBe(true);
    expect(savedResponse.request().postDataJSON().branchId).toBe(palet.id);
    const week = (branchId) => prisma.professional_weekly_schedules.findUniqueOrThrow({ where: {
      professional_id_branch_id_day_of_week: { professional_id: doctorAB.id, branch_id: branchId, day_of_week: 1 },
    } });
    expect((await week(palet.id)).start_time.toISOString().slice(11, 16)).toBe("10:20");
    expect((await week(romano.id)).start_time.toISOString().slice(11, 16)).toBe("09:00");

    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(Date.now() + 2 * 86400000);
    const blocks = page.locator("form.schedule-card").filter({ has: page.getByRole("heading", { name: "Bloqueos", exact: true }) });
    await blocks.getByLabel("Inicio", { exact: true }).fill(day + "T09:00");
    await blocks.getByLabel("Término", { exact: true }).fill(day + "T09:30");
    await blocks.getByLabel("Motivo opcional").fill("Bloqueo sintético Palet");
    const added = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/blocks"));
    await blocks.getByRole("button", { name: "Agregar bloqueo" }).click();
    const addedResponse = await added;
    expect(addedResponse.request().postDataJSON().branchId).toBe(palet.id);
    const { data: block } = await addedResponse.json();
    expect((await prisma.professional_schedule_blocks.findUniqueOrThrow({ where: { id: block.id } })).branch_id).toBe(palet.id);
    page.once("dialog", (dialog) => dialog.accept());
    const removed = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname.endsWith(block.id));
    await blocks.getByRole("button", { name: "Eliminar" }).click();
    const removedResponse = await removed;
    expectBranch(removedResponse, palet);

    const form = page.locator(".internal-booking");
    const patientSearch = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/patients");
    await form.getByPlaceholder("RUT o nombre").fill("Paciente solo Palet");
    await form.getByRole("button", { name: "Buscar", exact: true }).click();
    expectBranch(await patientSearch, palet);
    const available = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/availability"));
    await form.getByRole("combobox", { name: "Profesional" }).selectOption(doctorAB.id);
    expectBranch(await available, palet);
    const firstSlot = form.getByRole("combobox", { name: "Hora disponible" }).locator("option").nth(1);
    await expect(firstSlot).toHaveAttribute("value", /T/);
    await form.getByRole("combobox", { name: "Hora disponible" }).selectOption(await firstSlot.getAttribute("value"));
    const booked = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/appointments");
    await form.getByRole("button", { name: "Crear reserva" }).click();
    const bookedResponse = await booked;
    expect(bookedResponse.request().postDataJSON().branchId).toBe(palet.id);
    expect((await bookedResponse.json()).data.branchId).toBe(palet.id);
    await blocked(await page.request.get("/api/professionals?view=general"));
    await blocked(await page.request.post("/api/professionals", { data: { userId: doctorAB.id, appointmentDurationMinutes: 30, slotIntervalMinutes: 30 } }));
    await blocked(await page.request.patch("/api/professionals/" + doctorAB.id, { data: { isBookable: false } }));
  });

  test("profesional de dos sucursales elige la sede y conserva solo sus horarios", async ({ page }) => {
    const { romano, palet, barros, doctorAB } = sample;
    const observed = await enter(page, doctorAB);
    await expect(page.getByText(/Selecciona una sucursal en Sucursal activa/)).toBeVisible({ timeout: 4000 });
    expect(observed).toHaveLength(0);
    const selector = page.getByRole("combobox", { name: "Sucursal activa" });
    await expect(selector.locator("option", { hasText: barros.name })).toHaveCount(0);
    for (const branch of [romano, palet]) await expect(selector.locator("option", { hasText: branch.name })).toHaveCount(1);
    await selector.selectOption(palet.id);
    await expect(page.getByRole("button", { name: "Guardar horario" })).toBeEnabled();
    await expect(page.locator(".agenda-toolbar select").first()).toHaveValue(doctorAB.id);
    await expect(page.getByRole("heading", { name: "Perfiles profesionales" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Nueva reserva interna" })).toHaveCount(0);
    await blocked(await page.request.get("/api/professionals/" + doctorAB.id + "/schedule?branchId=" + barros.id));
  });
});

test("Primera visita en Palet requiere una vinculación administrativa comprobada", async ({ context, page, browser }) => {
  const romanoContext = await extraContext(browser);
  const general = await extraContext(browser);
  const { romano, palet, adminA, adminB, skuA } = sample;
  try {
    const rom = await login(romanoContext, adminA);
    const pal = await login(context, adminB);
    const admin = await login(general);
    const data = {
      rut: fixtureRut(6_000_000 + Number.parseInt(randomUUID().slice(0, 4), 16)), firstNames: "Visita nueva", lastNames: "Prueba",
      email: "visita-" + randomUUID() + "@example.invalid", phone: "+56912345678", address: "Dirección de prueba", branchId: romano.id,
    };
    const customer = await body(await rom.post("/api/customers", { data }), 201);
    const patient = await body(await rom.post("/api/patients", { data: { ...data, birthDate: "1990-01-01" } }), 201);
    const product = await prisma.products.findUniqueOrThrow({ where: { sku: skuA } });
    const draft = { branchId: palet.id, customerId: customer.id, patientId: patient.id, items: [{ productId: product.id, quantity: 1 }] };
    const original = await body(await rom.post("/api/sales", { data: { ...draft, branchId: romano.id } }), 201);
    const search = "?search=" + encodeURIComponent(data.rut) + "&branchId=" + palet.id;
    await page.goto("/app/ventas");
    await page.getByText("Cliente e historial (opcional)", { exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Sucursal de la venta" })).toHaveValue(palet.id);
    const input = page.getByRole("textbox", { name: "Buscar cliente" });
    const lookup = () => page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/customers" && url.searchParams.get("search") === data.rut;
    });
    const beforeLink = lookup();
    await input.fill(data.rut);
    expect((await (await beforeLink).json()).data.items).toEqual([]);
    await expect(page.getByRole("button", { name: /Visita nueva Prueba/ })).toHaveCount(0);
    for (const [resource, id] of [["customers", customer.id], ["patients", patient.id]]) {
      expect((await body(await pal.get("/api/" + resource + search))).items).toEqual([]);
      await blocked(await pal.get("/api/" + resource + "/" + id));
    }
    await blocked(await pal.post("/api/sales", { data: draft }));
    const duplicate = await pal.post("/api/customers", { data: { ...data, branchId: palet.id } });
    expect(duplicate.status()).toBe(409);
    expect(await prisma.customers.count({ where: { rut: data.rut } })).toBe(1);
    expect(await prisma.patients.count({ where: { rut: data.rut } })).toBe(1);
    const operation = { action: "LINK_CUSTOMER", branchId: palet.id, identityId: customer.id, identityVerified: true };
    await blocked(await pal.post("/api/inventory/branches", { data: operation }));
    expect((await admin.post("/api/inventory/branches", { data: { ...operation, identityVerified: false } })).status()).toBe(400);
    await body(await admin.post("/api/inventory/branches", { data: operation }));
    await blocked(await pal.get("/api/patients/" + patient.id));
    await body(await admin.post("/api/inventory/branches", { data: { ...operation, action: "LINK_PATIENT", identityId: patient.id } }));
    expect((await body(await pal.get("/api/customers" + search))).items.map((item) => item.id)).toEqual([customer.id]);
    await body(await pal.get("/api/patients/" + patient.id));
    const afterLink = lookup();
    await input.clear();
    await input.fill(data.rut);
    expect((await (await afterLink).json()).data.items.map((item) => item.id)).toEqual([customer.id]);
    await page.getByRole("button", { name: /Visita nueva Prueba/ }).click();
    await expect(page.getByText("Cliente: Visita nueva Prueba", { exact: true })).toBeVisible();
    await blocked(await pal.get("/api/sales/" + original.id));
    const quote = await body(await pal.post("/api/sales", { data: draft }), 201);
    expect(quote).toMatchObject({ branchId: palet.id, customer: { id: customer.id }, patient: { id: patient.id } });
    expect((await body(await pal.get("/api/customers/" + customer.id + "/history"))).items.map((item) => item.id)).toEqual([quote.id]);
  } finally {
    await Promise.all([romanoContext.close(), general.close()]);
  }
});

test.describe("Colisiones de Agenda por sede", () => {
  const timezone = "America/Santiago";

  function futureDay(offset) {
    const date = formatInTimeZone(new Date(Date.now() + offset * 86400000), timezone, "yyyy-MM-dd");
    return { date, at: (time) => fromZonedTime(date + "T" + time + ":00", timezone).toISOString() };
  }

  function operation(day, branch, time = "11:00") {
    return { branchId: branch.id, patientId: sample.patientAB, professionalId: sample.doctorAB.id, startAt: day.at(time) };
  }

  function schedulePath() {
    return "/api/professionals/" + sample.doctorAB.id + "/schedule";
  }

  async function createBlock(request, day, branch, expected = 201) {
    const response = await request.post(schedulePath() + "/blocks", { data: {
      branchId: branch.id, startAt: day.at("11:00"), endAt: day.at("11:30"), reason: "Bloqueo sintético de " + branch.name,
    } });
    if (expected === 201) return body(response, expected);
    expect(response.status()).toBe(expected);
    expect((await response.json()).error.code).toBe("SCHEDULE_BLOCK_OVERLAPS_APPOINTMENT");
  }

  async function hasTime(request, availabilityPath, day, branch, time) {
    const url = availabilityPath + "?" + new URLSearchParams({ date: day.date, branchId: branch.id });
    const { slots } = await body(await request.get(url));
    return slots.some((slot) => slot.startAt === day.at(time));
  }

  async function syntheticPatient() {
    const row = await prisma.patients.findUniqueOrThrow({ where: { id: sample.patientAB } });
    return {
      address: row.address, birthDate: row.birth_date.toISOString().slice(0, 10), email: row.email,
      firstNames: row.first_names, lastNames: row.last_names, phone: row.phone, rut: row.rut,
    };
  }

  async function loginOwner(context) {
    await body(await context.request.post("/api/store/accounts/login", {
      data: { email: sample.buyerEmail, password: sample.password },
    }));
    return context.request;
  }

  test("cada sede aplica su horario, excepción y bloqueos y toda cita ocupa al profesional", async ({ context }) => {
    const staff = await login(context);
    const { romano, palet, doctorAB } = sample;
    const day = futureDay(12);
    await prisma.professional_weekly_schedules.updateMany({
      where: { professional_id: doctorAB.id, branch_id: palet.id },
      data: { start_time: new Date("1970-01-01T10:00:00Z") },
    });
    await body(await staff.put(schedulePath() + "/overrides/" + day.date, { data: {
      branchId: romano.id, isWorking: true, startTime: "10:30", endTime: "13:00", breakStart: null, breakEnd: null,
    } }));
    const block = await createBlock(staff, day, romano);
    const path = "/api/professionals/" + doctorAB.id + "/availability";
    expect(await hasTime(staff, path, day, romano, "10:00")).toBe(false);
    expect(await hasTime(staff, path, day, palet, "10:00")).toBe(true);
    expect(await hasTime(staff, path, day, romano, "11:00")).toBe(false);
    expect(await hasTime(staff, path, day, palet, "11:00")).toBe(true);
    expect(await hasTime(staff, path, day, romano, "13:00")).toBe(false);
    expect(await hasTime(staff, path, day, palet, "13:00")).toBe(true);
    const dates = { from: day.at("09:00"), to: day.at("17:00") };
    const list = (branch) => staff.get(schedulePath() + "/blocks?" + new URLSearchParams({ ...dates, branchId: branch.id }));
    expect((await body(await list(romano))).map((item) => item.id)).toEqual([block.id]);
    expect(await body(await list(palet))).toEqual([]);

    const booked = await body(await staff.post("/api/appointments", { data: operation(day, palet) }), 201);
    expect(booked.branchId).toBe(palet.id);
    expect((await staff.delete(schedulePath() + "/blocks/" + block.id + "?branchId=" + romano.id)).status()).toBe(204);
    expect(await hasTime(staff, path, day, romano, "11:00")).toBe(false);
    expect((await staff.post("/api/appointments", { data: operation(day, romano) })).status()).toBe(409);
    await createBlock(staff, day, romano);
    await createBlock(staff, day, palet, 409);
  });

  test("reserva pública, actualización interna y Mi cuenta usan los bloqueos de Palet", async ({ context, browser }) => {
    const buyer = await extraContext(browser);
    try {
      const staff = await login(context);
      const owner = await loginOwner(buyer);
      const { romano, palet, doctorAB } = sample;
      const publicDay = futureDay(14), editDay = futureDay(15), accountDay = futureDay(16);
      for (const day of [publicDay, editDay, accountDay]) await createBlock(staff, day, romano);
      const publicPath = "/api/store/booking/professionals/" + doctorAB.id + "/availability";
      expect(await hasTime(owner, publicPath, publicDay, romano, "11:00")).toBe(false);
      expect(await hasTime(owner, publicPath, publicDay, palet, "11:00")).toBe(true);
      const appointment = await body(await owner.post("/api/store/booking", { data: {
        ...operation(publicDay, palet), acceptsPrivacy: true, patient: await syntheticPatient(),
      } }), 201);
      const id = appointment.appointment.id;
      const updated = await body(await staff.patch("/api/appointments/" + id, { data: { startAt: editDay.at("11:00") } }));
      expect(updated).toMatchObject({ branchId: palet.id, startAt: editDay.at("11:00") });
      const accountPath = "/api/store/accounts/me/clinical/appointments/" + id;
      expect(await hasTime(owner, accountPath, accountDay, romano, "11:00")).toBe(true);
      await body(await owner.patch(accountPath, { data: {
        action: "RESCHEDULE", expectedStartAt: editDay.at("11:00"), startAt: accountDay.at("11:00"),
      } }));
      expect(await prisma.appointments.findUniqueOrThrow({ where: { id } })).toMatchObject({
        branch_id: palet.id, start_at: new Date(accountDay.at("11:00")),
      });
      expect(await hasTime(staff, "/api/professionals/" + doctorAB.id + "/availability", accountDay, romano, "11:00")).toBe(false);
    } finally {
      await buyer.close();
    }
  });

  test("los cuatro repositorios de reserva vuelven a comprobar la sede dentro de la transacción", async ({ context }) => {
    const staff = await login(context);
    const handler = await actorFor(sample.adminB.id);
    const { romano, palet, doctorAB, patientAB } = sample;
    const [internalDay, publicDay, editDay, accountDay, originDay] = [18, 19, 20, 21, 22].map(futureDay);
    for (const day of [internalDay, publicDay, editDay, accountDay]) await createBlock(staff, day, romano);
    const slot = (day) => ({ startAt: new Date(day.at("11:00")), endAt: new Date(day.at("11:30")) });
    const data = { patientId: patientAB, professionalId: doctorAB.id, branchId: palet.id, internalNotes: null };
    const internal = await createAppointmentRepository({ ...data, ...slot(internalDay) }, handler.userId, { actor: handler });
    expect(internal.conflict).toBeNull();
    expect(internal.appointment.branchId).toBe(palet.id);
    expect((await createAppointmentRepository({ ...data, branchId: romano.id, ...slot(internalDay) }, null)).conflict).toBe("APPOINTMENT");

    const publicResult = await createPublicBookingRepository({
      ...data, ...slot(publicDay), patient: await syntheticPatient(),
      manageTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    });
    expect(publicResult.conflict).toBeNull();
    expect(publicResult.appointment.branchId).toBe(palet.id);
    const original = await body(await staff.post("/api/appointments", { data: operation(originDay, palet) }), 201);
    const edit = await updateAppointmentRepository(original.id, slot(editDay), handler.userId, handler);
    expect(edit.conflict).toBeNull();
    expect(edit.appointment.branchId).toBe(palet.id);
    const account = await prisma.customer_accounts.findUniqueOrThrow({ where: { customer_id: sample.customerA } });
    const customerResult = await updateCustomerAppointment(account.id, original.id, {
      expectedStart: slot(editDay).startAt, slot: slot(accountDay), now: new Date(), noticeHours: 24, reminderHours: 24,
    });
    expect(customerResult.reason).toBeNull();
    const row = await prisma.appointments.findUniqueOrThrow({ where: { id: original.id } });
    expect(row).toMatchObject({ branch_id: palet.id, start_at: slot(accountDay).startAt });
    expect((await createAppointmentRepository({ ...data, branchId: romano.id, ...slot(editDay) }, null)).conflict).toBe("SCHEDULE_BLOCK");
  });

  test("conservar ocupación histórica global y rechazar reservas simultáneas entre sucursales", async ({ context, browser }) => {
    const buyer = await extraContext(browser);
    try {
      const staff = await login(context);
      const owner = await loginOwner(buyer);
      const { romano, palet, doctorAB, patientAB } = sample;
      const [historicalDay, newDay, raceDay, localRaceDay] = [24, 25, 26, 27].map(futureDay);
      const date = (day, value) => new Date(day.at(value));
      const old = await prisma.appointments.create({ data: {
        patient_id: patientAB, professional_id: doctorAB.id, start_at: date(historicalDay, "11:00"), end_at: date(historicalDay, "11:30"),
      } });
      const start = date(newDay, "11:00");
      const end = date(newDay, "11:30");
      const weekday = new Date(newDay.date + "T12:00:00Z").getUTCDay();
      await prisma.professional_weekly_schedules.create({ data: {
        professional_id: doctorAB.id, day_of_week: weekday, is_working: true,
        start_time: new Date("1970-01-01T09:00:00Z"), end_time: new Date("1970-01-01T18:00:00Z"),
      } });
      await prisma.professional_schedule_blocks.create({ data: {
        professional_id: doctorAB.id, created_by: doctorAB.id, start_at: date(newDay, "10:00"), end_at: date(newDay, "10:30"),
      } });
      const path = "/api/professionals/" + doctorAB.id + "/availability";
      for (const branch of [romano, palet]) expect(await hasTime(staff, path, historicalDay, branch, "11:00")).toBe(false);
      await createBlock(staff, historicalDay, romano, 409);
      await createBlock(staff, newDay, romano);
      const oldPath = "/api/store/accounts/me/clinical/appointments/" + old.id;
      expect(await hasTime(owner, oldPath, newDay, palet, "10:00")).toBe(false);
      expect(await hasTime(owner, oldPath, newDay, palet, "11:00")).toBe(true);
      await body(await owner.patch(oldPath, { data: {
        action: "RESCHEDULE", expectedStartAt: historicalDay.at("11:00"), startAt: newDay.at("11:00"),
      } }));
      expect(await prisma.appointments.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ branch_id: null, start_at: start, end_at: end });

      const races = await Promise.all([romano, palet].map((branch) => staff.post("/api/appointments", { data: operation(raceDay, branch) })));
      expect(races.map((item) => item.status()).sort()).toEqual([201, 409]);
      expect(await prisma.appointments.count({ where: { professional_id: doctorAB.id, start_at: date(raceDay, "11:00") } })).toBe(1);

      const [booked, blocked] = await Promise.all([
        staff.post("/api/appointments", { data: operation(localRaceDay, palet) }),
        staff.post(schedulePath() + "/blocks", { data: { branchId: palet.id, startAt: localRaceDay.at("11:00"), endAt: localRaceDay.at("11:30") } }),
      ]);
      expect([booked.status(), blocked.status()].sort()).toEqual([201, 409]);
    } finally {
      await buyer.close();
    }
  });
});
