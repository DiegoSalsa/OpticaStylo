import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { shippingConfiguration } from "../src/config/shipping.js";
import { quoteCart, quoteSnapshot, saveShippingQuotes } from "../src/repositories/shipping-repository.js";
import { prisma } from "../src/db/prisma.js";
import { seedAcademicData, requireAcademicIsolation } from "../tests/fixtures/academic-data.js";
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
