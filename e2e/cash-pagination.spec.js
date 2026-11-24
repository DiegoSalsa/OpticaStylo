import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { prisma } from "../src/db/prisma.js";
import { requireAcademicIsolation, seedAcademicData } from "../tests/fixtures/academic-data.js";
import { accountingFieldsOf, seedCashPagination } from "../tests/fixtures/cash-pagination-data.js";
import { isolateBrowserNetwork } from "./isolated-network.js";

let sample;

test.beforeAll(async () => {
  requireAcademicIsolation();
  await seedAcademicData();
  sample = await seedCashPagination();
});
test.afterAll(async () => prisma.$disconnect());
test.beforeEach(async ({ context }) => {
  requireAcademicIsolation();
  await prisma.public_request_rate_limits.deleteMany();
  await isolateBrowserNetwork(context);
});

async function login(page, profile = "administrador") {
  const { password } = JSON.parse(await readFile("tmp/academic-validation/demo-credentials.json", "utf8"));
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico", { exact: true }).fill("academic-" + profile + "@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar de forma segura" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function data(response, status = 200) {
  const body = await response.json();
  expect(response.status(), body.error?.message).toBe(status);
  expect(body.success).toBe(true);
  return body.data;
}

const prefix = (session) => "/api/cash-register/" + session.id;
const paging = (scope, label) => scope.getByRole("navigation", { name: "Paginación de " + label, exact: true });
const cashPanel = (page) => page.getByRole("region", { name: "Caja de la sucursal" });

async function openPanel(page, { main, busyTerminal }) {
  await page.goto("/app/ventas");
  await page.getByRole("combobox", { name: "Sucursal de la venta", exact: true }).selectOption(main.id);
  const cash = cashPanel(page);
  const terminal = cash.getByRole("combobox", { name: "Punto de cobro" });
  const expectedCash = cash.getByText("Efectivo esperado", { exact: true });
  await expect(terminal).toHaveValue(busyTerminal.id);
  await expect(expectedCash).toBeVisible();
  await terminal.selectOption(busyTerminal.id);
  await expect(expectedCash).toBeVisible();
  return cash;
}

test("Paginación de Caja recorre 140 movimientos y 120 pagos con altas concurrentes al final", async ({ page }) => {
  await login(page);
  const local = await seedCashPagination();
  const url = prefix(local.busy);
  const opened = await data(await page.request.get(url + "?view=summary"));
  expect(accountingFieldsOf(opened)).toEqual(local.expected);
  expect(opened).not.toHaveProperty("payments");
  expect(opened).not.toHaveProperty("movements");
  const preview = await data(await page.request.get(url));
  expect(preview.movements).toHaveLength(20);
  expect(preview.payments).toHaveLength(20);
  expect(preview.movementPagination).toMatchObject({ total: 140, totalPages: 7 });
  expect(preview.paymentPagination).toMatchObject({ total: 120, totalPages: 6 });

  for (const [kind, total] of [["movements", 140], ["payments", 120]]) {
    const exact = await data(await page.request.get(url + "/" + kind + "?page=999"));
    expect(exact).toMatchObject({ total, page: total / 20, totalPages: total / 20 });
    expect(exact.items).toHaveLength(20);
    const partial = await data(await page.request.get(url + "/" + kind + "?pageSize=19&page=999"));
    expect(partial.items).toHaveLength(total % 19);
    expect((await page.request.get(url + "/" + kind + "?pageSize=101")).status()).toBe(400);
  }

  const first = await data(await page.request.get(url + "/movements"));
  expect(first.items.find((row) => row.id === local.old[0].id)).toMatchObject({ reversed: true });
  const key = randomUUID();
  const writes = page.request.post(url + "/movements?view=summary", {
    headers: { "X-Idempotency-Key": key },
    data: { movementType: "MANUAL_IN", amountCents: 11, reason: "Ingreso durante la navegación" },
  });
  const more = page.request.get(url + "/movements?page=2");
  const [registered, second] = await Promise.all([writes.then((response) => data(response)), more.then((response) => data(response))]);
  expect(registered.expectedAmountCents).toBe(local.expected.expectedAmountCents + 11);
  expect(registered.receivedCents).toBe(local.expected.receivedCents);
  const movementIds = [...first.items, ...second.items].map((item) => item.id);
  for (let index = 3; index <= 8; index += 1) {
    const current = await data(await page.request.get(url + "/movements?page=" + index));
    expect(current).toMatchObject({ total: 141, totalPages: 8, page: index });
    movementIds.push(...current.items.map((item) => item.id));
    if (index === 8) expect(current.items.map((row) => row.operationId)).toEqual([key]);
  }
  expect(movementIds.slice(0, -1)).toEqual(local.movementIds);
  expect(new Set(movementIds).size).toBe(141);
  const paymentIds = [];
  for (let index = 1; index <= 6; index += 1) {
    const current = await data(await page.request.get(url + "/payments?page=" + index));
    paymentIds.push(...current.items.map((item) => item.id));
  }
  expect(paymentIds).toEqual(local.paymentIds);
});

test("Paginación de Caja persiste el resumen completo al cerrar con diferencia y saldo pendiente", async ({ page }) => {
  await login(page);
  const local = await seedCashPagination();
  const url = prefix(local.busy);
  const opts = (closingCountedCents, closingNotes) => ({ data: { closingCountedCents, closingNotes } });
  expect((await page.request.post(url + "/close", opts(local.expected.expectedAmountCents, null))).status()).toBe(400);
  const counted = local.expected.expectedAmountCents - 7;
  expect((await page.request.post(url + "/close", opts(counted, null))).status()).toBe(400);
  const closed = await data(await page.request.post(url + "/close?view=summary", opts(counted, "Arqueo sintético con saldo y diferencia")));
  expect(closed).toMatchObject({ status: "CLOSED", differenceCents: -7, closingCountedCents: counted });
  expect(accountingFieldsOf(closed)).toEqual(local.expected);
  expect((await prisma.cash_register_sessions.findUniqueOrThrow({ where: { id: local.busy.id } })).closing_summary).toEqual(local.expected);
  const history = await data(await page.request.get(url + "?view=summary"));
  expect(accountingFieldsOf(history)).toEqual(local.expected);
  expect((await data(await page.request.get(url + "/payments?page=6"))).items).toHaveLength(20);
  expect((await data(await page.request.get(url + "/movements?page=7"))).items).toHaveLength(20);
  expect((await page.request.post(url + "/movements", {
    headers: { "X-Idempotency-Key": randomUUID() },
    data: { movementType: "MANUAL_IN", amountCents: 1, reason: "No procede después del cierre" },
  })).status()).toBe(409);

  if (process.env.CASH_REFERENCE_FILE) {
    const previous = JSON.parse(await readFile(process.env.CASH_REFERENCE_FILE, "utf8"));
    const comparable = { ...accountingFieldsOf(closed), pending: closed.pending.map(({ balanceCents }) => ({ balanceCents })) };
    expect(comparable).toEqual(previous.closed);
    expect(comparable).toEqual(previous.totals);
    expect(closed.closingCountedCents).toBe(previous.counted);
    expect(closed.differenceCents).toBe(previous.difference);
  }
});

test("Paginación de Caja protege el libro por responsable, sucursal y rol", async ({ page }) => {
  await login(page, "ventas");
  for (const book of ["/movements", "/payments"]) {
    expect((await page.request.get(prefix(sample.busy) + book)).status()).toBe(403);
    expect((await page.request.get(prefix(sample.other) + book)).status()).toBe(403);
  }
  expect((await data(await page.request.get(prefix(sample.own) + "/payments"))).total).toBe(1);
  expect((await data(await page.request.get(prefix(sample.own) + "/movements"))).total).toBe(0);
  await page.context().clearCookies();
  await login(page, "profesional");
  expect((await page.request.get(prefix(sample.own) + "/movements")).status()).toBe(403);
  expect((await page.request.get(prefix(sample.own) + "/payments")).status()).toBe(403);
});

for (const width of [390, 768, 1440]) {
  test("Paginación de Caja mantiene los libros independientes a " + width + " px", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    const cash = await openPanel(page, sample);
    await cash.getByText("Movimientos y pagos de esta sesión", { exact: true }).click();
    const movements = cash.getByRole("region", { name: "Libro de movimientos" });
    const payments = cash.getByRole("region", { name: "Libro de pagos" });
    const movementNav = paging(movements, "movimientos de caja");
    const paymentNav = paging(payments, "pagos de caja");
    await expect(movements.getByRole("row").filter({ hasText: "Original sintético revertido MANUAL_IN" })).toContainText("Reversado");
    await expect(movementNav.getByRole("button", { name: "Página 1", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(paymentNav.getByRole("button", { name: "Página 1", exact: true })).toHaveAttribute("aria-current", "page");

    if (width === 390) {
      await page.route((url) => url.pathname === prefix(sample.busy) + "/payments" && url.searchParams.get("page") === "2", (route) =>
        route.fulfill({ status: 503, json: { success: false, error: { message: "No se pudieron consultar los pagos" } } }), { times: 1 });
    }
    await paymentNav.getByRole("button", { name: "Siguiente", exact: true }).click();
    if (width === 390) {
      await expect(payments.getByRole("alert")).toContainText("No se pudieron consultar los pagos");
      await expect(movements.getByRole("table")).toBeVisible();
      await payments.getByRole("button", { name: "Reintentar" }).click();
    }
    await expect(paymentNav.getByRole("button", { name: "Página 2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(movementNav.getByRole("button", { name: "Página 1", exact: true })).toHaveAttribute("aria-current", "page");
    await movementNav.getByRole("button", { name: "Página 7", exact: true }).click();
    await expect(movements.getByText("Mostrando 121–140 de 140")).toBeVisible();
    await expect(movementNav.getByRole("button", { name: "Siguiente", exact: true })).toBeDisabled();
    await expect(paymentNav.getByRole("button", { name: "Página 2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(cash.getByText("60 ventas con cobros", { exact: false })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    test.info().annotations.push({ type: "ancho del documento", description: JSON.stringify(dimensions) });
  });
}

test("Paginación de Caja permite revertir un retiro antiguo con trazabilidad", async ({ page }) => {
  await login(page);
  const cash = await openPanel(page, sample);
  await cash.getByText("Movimientos y pagos de esta sesión", { exact: true }).click();
  const movements = cash.getByRole("region", { name: "Libro de movimientos" });
  const nav = paging(movements, "movimientos de caja");
  await nav.getByRole("button", { name: "Página 7", exact: true }).click();
  await nav.getByRole("button", { name: "Página 1", exact: true }).click();
  const row = movements.getByRole("row").filter({ hasText: sample.oldWithdrawal.reason });
  await row.getByText("Reversar", { exact: true }).click();
  await row.getByRole("textbox").fill("Reversar retiro sintético antiguo");
  await row.getByRole("button", { name: "Confirmar reverso" }).click();
  await expect(row).toContainText("Reversado");
  const reversal = await prisma.cash_register_movements.findUniqueOrThrow({ where: { reversal_of: sample.oldWithdrawal.id } });
  expect(reversal.amount_cents).toBe(BigInt(sample.oldWithdrawal.amount_cents));
  const summary = await data(await page.request.get(prefix(sample.busy) + "?view=summary"));
  expect(summary.expectedAmountCents).toBe(sample.expected.expectedAmountCents + sample.oldWithdrawal.amount_cents);
});

test("Paginación de Caja enumera el historial completo y restringe el consolidado", async ({ page }) => {
  await login(page);
  const url = "/api/cash-register?history=true&branchId=" + sample.main.id;
  const ordered = [];
  for (let index = 1; index <= 3; index += 1) {
    const sessions = await data(await page.request.get(url + "&page=" + index));
    expect(sessions).toMatchObject({ total: 62, totalPages: 3, pageSize: 30, page: index });
    expect(sessions.items).toHaveLength(index === 3 ? 2 : 30);
    ordered.push(...sessions.items.map((session) => session.id));
  }
  expect(ordered).toEqual([
    ...sample.history.map((row) => row.id).sort().reverse(),
    ...[sample.busy.id, sample.own.id].sort().reverse(),
  ]);
  expect(new Set(ordered).size).toBe(62);
  const full = await data(await page.request.get(url + "&page=999&pageSize=31"));
  expect(full).toMatchObject({ page: 2, total: 62, totalPages: 2 });
  expect(full.items).toHaveLength(31);
  expect((await page.request.get(url + "&pageSize=101")).status()).toBe(400);
  const remote = await data(await page.request.get("/api/cash-register?history=true&branchId=" + sample.remote.id));
  expect(remote.items.map((row) => row.id)).toEqual([sample.other.id]);
  const consolidated = await data(await page.request.get("/api/cash-register?history=true&consolidated=true"));
  expect(consolidated.total).toBeGreaterThan(62);

  await page.context().clearCookies();
  await login(page, "ventas");
  const own = await data(await page.request.get(url));
  expect(own.items.map((row) => row.id)).toEqual([sample.own.id]);
  expect(own.total).toBe(1);
  expect((await page.request.get("/api/cash-register?history=true&consolidated=true")).status()).toBe(403);
  expect((await page.request.get("/api/cash-register?history=true&branchId=" + sample.remote.id)).status()).toBe(403);
});

test("Paginación de Caja reintenta el historial y abre un cierre de la última página", async ({ page }) => {
  await login(page);
  const local = await seedCashPagination();
  await data(await page.request.post(prefix(local.busy) + "/close?view=summary", {
    data: { closingCountedCents: local.expected.expectedAmountCents, closingNotes: "Saldo pendiente de la sesión archivada" },
  }));
  await page.goto("/app/ventas");
  await page.getByRole("combobox", { name: "Sucursal de la venta", exact: true }).selectOption(local.main.id);
  const cash = cashPanel(page);
  const history = cash.getByRole("region", { name: "Historial de sesiones de caja" });
  await page.route((url) => url.pathname === "/api/cash-register" && url.searchParams.get("history") === "true"
    && url.searchParams.get("branchId") === local.main.id, (route) => route.fulfill({
    status: 503, json: { success: false, error: { message: "Historial temporalmente indisponible" } },
  }), { times: 1 });
  await cash.getByText("Historial de aperturas y cierres", { exact: true }).click();
  await expect(history.getByRole("alert")).toContainText("Historial temporalmente indisponible");
  await history.getByRole("button", { name: "Reintentar" }).click();
  const nav = paging(history, "sesiones de caja");
  await nav.getByRole("button", { name: "Página 4", exact: true }).click();
  await expect(history.getByText("Mostrando 61–62 de 62")).toBeVisible();
  await expect(nav.getByRole("button", { name: "Siguiente", exact: true })).toBeDisabled();
  await history.getByRole("button", { name: "Ver cierre", exact: true }).click();
  await expect(cash.getByText("Cierre guardado", { exact: false })).toBeVisible();
  await cash.getByText("Movimientos y pagos de esta sesión", { exact: true }).click();
  const payments = cash.getByRole("region", { name: "Libro de pagos" });
  await paging(payments, "pagos de caja").getByRole("button", { name: "Página 6", exact: true }).click();
  await expect(payments.getByText("Mostrando 101–120 de 120")).toBeVisible();
  await expect(cash.getByText("60 ventas con cobros", { exact: false })).toBeVisible();
  await expect(cash.getByRole("button", { name: "Confirmar reverso" })).toHaveCount(0);
});
