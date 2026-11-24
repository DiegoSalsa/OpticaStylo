import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { prisma } from "../src/db/prisma.js";
import { seedAcademicData, requireAcademicIsolation } from "../tests/fixtures/academic-data.js";
import { seedInventoryPagination } from "../tests/fixtures/inventory-pagination-data.js";
import { isolateBrowserNetwork } from "./isolated-network.js";

let sample;

test.beforeAll(async () => {
  requireAcademicIsolation();
  await seedAcademicData();
  sample = await seedInventoryPagination();
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

function endpoint(path, params) {
  return "/api/inventory" + path + "?" + new URLSearchParams(params);
}

async function data(response) {
  expect(response.ok(), "HTTP " + response.status()).toBe(true);
  const body = await response.json();
  expect(body.success).toBe(true);
  return body.data;
}

async function appendMovement(page, reason) {
  await data(await page.request.post("/api/inventory", {
    headers: { "X-Idempotency-Key": randomUUID() },
    data: { kind: "ENTRY", branchId: sample.main.id, productId: sample.historyProduct.id, quantity: 1, reason },
  }));
}

async function chooseBranch(page, branchId) {
  await page.getByRole("combobox", { name: "Sucursal", exact: true }).selectOption(branchId);
}

const transfers = (page) => page.getByRole("region", { name: "Transferencias" });
const history = (page) => page.getByRole("region", { name: "Historial de movimientos" });
const pages = (scope, name) => scope.getByRole("navigation", { name: "Paginación de " + name, exact: true });

test("Paginación de Inventario recorre 122 traspasos y 120 movimientos sin repetir ni omitir IDs", async ({ page }) => {
  await login(page);
  const branchId = sample.main.id;
  const transferIds = [];
  for (let index = 1; index <= 7; index += 1) {
    const result = await data(await page.request.get(endpoint("/transfers", { branchId, page: index })));
    expect(result).toMatchObject({ page: index, pageSize: 20, total: 122, totalPages: 7 });
    expect(result.items).toHaveLength(index === 7 ? 2 : 20);
    transferIds.push(...result.items.map((item) => item.id));
  }
  expect(transferIds).toEqual(sample.transferIds);
  expect(new Set(transferIds).size).toBe(122);
  const lastTransfer = await data(await page.request.get(endpoint("/transfers", { branchId, status: "RECEIVED", page: 999 })));
  expect(lastTransfer).toMatchObject({ page: 6, total: 120, totalPages: 6 });
  expect(lastTransfer.items).toHaveLength(20);
  expect(lastTransfer.items.every((item) => item.status === "RECEIVED")).toBe(true);
  expect(lastTransfer.items[0].destination).toEqual({ id: sample.other.id, name: sample.other.name });

  const productId = sample.historyProduct.id;
  const first = await data(await page.request.get(endpoint("/movements", { branchId, productId })));
  expect(first).toMatchObject({ page: 1, total: 120, totalPages: 6 });
  const movementIds = first.items.map((row) => row.id);
  await appendMovement(page, "Movimiento concurrente de prueba");
  for (let index = 2; index <= 6; index += 1) {
    const result = await data(await page.request.get(endpoint("/movements", { branchId, productId, page: index, asOf: first.asOf })));
    expect(result).toMatchObject({ page: index, total: 120, totalPages: 6 });
    expect(result.items).toHaveLength(20);
    movementIds.push(...result.items.map((row) => row.id));
  }
  expect(movementIds).toEqual(sample.movementIds);
  expect(new Set(movementIds).size).toBe(120);
  const lastMovement = await data(await page.request.get(endpoint("/movements", { branchId, productId, page: 999 })));
  expect(lastMovement).toMatchObject({ page: 7, total: 121, totalPages: 7 });
  expect(lastMovement.items).toHaveLength(1);
  const refreshed = await data(await page.request.get(endpoint("/movements", { branchId, productId })));
  expect(refreshed.items[0].reason).toBe("Movimiento concurrente de prueba");

  for (const path of ["/transfers", "/movements", "/movement-products"]) {
    expect((await page.request.get(endpoint(path, { branchId, pageSize: 101 }))).status()).toBe(400);
    expect((await page.request.get(endpoint(path, { branchId, page: 0 }))).status()).toBe(400);
  }
  expect((await page.request.get(endpoint("/transfers", { branchId, status: "INVALIDO" }))).status()).toBe(400);
});

test("Paginación de Inventario separa las sucursales y la búsqueda por producto autorizada", async ({ page }) => {
  await login(page, "ventas");
  const branchId = sample.main.id;
  for (const path of ["", "/transfers", "/movements", "/movement-products"]) {
    const denied = await page.request.get(endpoint(path, { branchId: sample.privateBranch.id }));
    expect(denied.status()).toBe(403);
  }

  const firstStock = await data(await page.request.get(endpoint("", { branchId })));
  expect(firstStock.items.some((item) => item.id === sample.historyProduct.id)).toBe(false);
  for (const search of [sample.historyProduct.sku.toLowerCase(), sample.historyProduct.name.toUpperCase()]) {
    const match = await data(await page.request.get(endpoint("/movement-products", { branchId, search })));
    expect(match.items).toEqual([{ id: sample.historyProduct.id, name: sample.historyProduct.name, sku: sample.historyProduct.sku }]);
  }
  const hidden = await data(await page.request.get(endpoint("/movement-products", { branchId, search: sample.privateProduct.sku })));
  expect(hidden).toMatchObject({ items: [], total: 0, totalPages: 0 });
  const hiddenHistory = await data(await page.request.get(endpoint("/movements", { branchId, productId: sample.privateProduct.id })));
  expect(hiddenHistory.items).toEqual([]);
  const branchTransfers = await data(await page.request.get(endpoint("/transfers", { branchId, pageSize: 100 })));
  expect(branchTransfers.total).toBe(122);
  expect(branchTransfers.items.some((item) => item.id === sample.unrelated.id)).toBe(false);
});

for (const width of [390, 768, 1440]) {
  test("Paginación de Inventario filtra y cambia de sucursal a " + width + " px", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto("/app/inventario");
    await chooseBranch(page, sample.main.id);
    const shipments = transfers(page);
    const records = history(page);
    await expect(shipments.getByText("Página 1 de 7")).toBeVisible();
    await pages(shipments, "transferencias").getByRole("button", { name: "Página 7" }).click();
    await expect(shipments.getByText("Página 7 de 7")).toBeVisible();
    await expect(pages(shipments, "transferencias").getByRole("button", { name: "Siguiente" })).toBeDisabled();
    await shipments.getByRole("combobox", { name: "Estado del traspaso" }).selectOption("RECEIVED");
    await expect(shipments.getByText("Página 1 de 6")).toBeVisible();
    const shipmentPagination = pages(shipments, "transferencias");
    await shipmentPagination.getByRole("button", { name: "Página 6", exact: true }).click();
    await expect(shipments.getByText("Mostrando 101–120 de 120")).toBeVisible();
    await expect(shipmentPagination.getByRole("button", { name: "Siguiente", exact: true })).toBeDisabled();
    await shipments.getByRole("combobox", { name: "Estado del traspaso" }).selectOption("CANCELLED");
    await expect(shipments.getByText("Sin transferencias para este filtro.")).toBeVisible();

    await pages(records, "productos del historial").getByRole("button", { name: "Siguiente" }).click();
    await expect(pages(records, "productos del historial").getByRole("button", { name: "Página 2" })).toHaveAttribute("aria-current", "page");
    const query = records.getByRole("textbox", { name: "Buscar producto en el historial" });
    await query.fill(sample.historyProduct.sku);
    await records.getByRole("button", { name: "Buscar por nombre o SKU" }).click();
    await records.getByRole("combobox", { name: "Producto del historial" }).selectOption(sample.historyProduct.id);

    const historyPagination = pages(records, "movimientos");
    await expect(historyPagination.getByRole("button", { name: "Página 1" })).toHaveAttribute("aria-current", "page");
    await historyPagination.getByRole("button", { name: "Siguiente" }).click();
    await expect(historyPagination.getByRole("button", { name: "Página 2" })).toHaveAttribute("aria-current", "page");
    await expect(records.getByText("Producto seleccionado: " + sample.historyProduct.sku, { exact: false })).toBeVisible();
    await expect(records.getByRole("combobox", { name: "Producto del historial" })).toHaveValue(sample.historyProduct.id);
    await expect(records.getByRole("table").getByRole("row")).toHaveCount(21);
    await historyPagination.getByRole("button", { name: "Anterior", exact: true }).click();
    await expect(historyPagination.getByRole("button", { name: "Página 1", exact: true })).toHaveAttribute("aria-current", "page");

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
    }));
    test.info().annotations.push({ type: "ancho del documento", description: JSON.stringify(dimensions) });

    await chooseBranch(page, sample.other.id);
    await expect(shipments).toHaveCount(1);
    await expect(records).toHaveCount(1);
    await expect(shipments.getByRole("combobox", { name: "Estado del traspaso" })).toHaveValue("");
    await expect(records.getByText("Producto seleccionado:", { exact: false })).toHaveCount(0);
    await expect(historyPagination.getByRole("button", { name: "Página 1" })).toHaveAttribute("aria-current", "page");
  });
}

test("Paginación de Inventario reintenta un error y permite recibir y cancelar desde la página avanzada", async ({ page }) => {
  await login(page);
  await page.goto("/app/inventario");
  const shipments = transfers(page);
  const match = (url) => url.pathname === "/api/inventory/transfers" && url.searchParams.get("branchId") === sample.main.id;
  await page.route(match, (route) => route.fulfill({
    status: 503,
    json: { success: false, error: { message: "Error temporal de traspasos" } },
  }), { times: 1 });
  await chooseBranch(page, sample.main.id);
  await expect(shipments.getByRole("alert")).toContainText("Error temporal de traspasos");
  await shipments.getByRole("button", { name: "Reintentar" }).click();
  await expect(shipments.getByRole("alert")).toHaveCount(0);
  await pages(shipments, "transferencias").getByRole("button", { name: "Página 7" }).click();
  await expect(shipments.getByText("Página 7 de 7")).toBeVisible();
  for (const [label, row, status] of [
    ["Confirmar recepción física", sample.inbound, "RECEIVED"],
    ["Cancelar y devolver al origen", sample.outbound, "CANCELLED"],
  ]) {
    const action = shipments.getByRole("button", { name: label });
    await action.click();
    await expect(action).toHaveCount(0);
    await expect(shipments.getByText("Página 7 de 7")).toBeVisible();
    expect((await prisma.inventory_transfers.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(status);
  }
});

test("Paginación de Inventario actualiza el historial después de registrar un movimiento", async ({ page }) => {
  await login(page);
  await page.goto("/app/inventario");
  await chooseBranch(page, sample.main.id);
  const records = history(page);
  await records.getByRole("textbox", { name: "Buscar producto en el historial" }).fill(sample.historyProduct.name);
  await records.getByRole("button", { name: "Buscar por nombre o SKU" }).click();
  await records.getByRole("combobox", { name: "Producto del historial" }).selectOption(sample.historyProduct.id);
  await pages(records, "movimientos").getByRole("button", { name: "Siguiente" }).click();
  await expect(pages(records, "movimientos").getByRole("button", { name: "Página 2" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("textbox", { name: "Buscar producto", exact: true }).fill(sample.historyProduct.sku);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("button", { name: "Registrar movimiento de " + sample.historyProduct.sku }).click();
  await page.getByLabel("Cantidad del movimiento").fill("1");
  await page.getByRole("textbox", { name: "Motivo u origen" }).fill("Movimiento registrado desde la interfaz");
  await page.getByRole("button", { name: "Confirmar movimiento" }).click();

  await expect(records.getByText("Movimiento registrado desde la interfaz")).toBeVisible();
  await expect(pages(records, "movimientos").getByRole("button", { name: "Página 1" })).toHaveAttribute("aria-current", "page");
  await expect(records.getByText("Producto seleccionado: " + sample.historyProduct.sku, { exact: false })).toBeVisible();
});
