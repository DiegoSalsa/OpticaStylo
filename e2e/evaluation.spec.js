import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import { connectEvaluationDatabase, evaluation } from "../tests/fixtures/evaluation-data.js";
import { fixtureRut } from "../tests/fixtures/management-data.js";

async function loginFromForm(page) {
  await test.step("Iniciar sesión con el formulario real de administrador", async () => {
    await page.goto("/ingresar");
    await expect(page.getByRole("heading", { name: "Bienvenido de vuelta" })).toBeVisible();
    await page.getByLabel("Correo electrónico", { exact: true }).fill(evaluation.adminEmail);
    await page.getByLabel("Contraseña", { exact: true }).fill(evaluation.password);
    const response = page.waitForResponse((result) => result.url().endsWith("/api/auth/login")
      && result.request().method() === "POST");
    await page.getByRole("button", { name: "Ingresar de forma segura" }).click();
    expect((await response).status()).toBe(200);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("navigation", { name: "Navegación interna", exact: true })).toBeVisible();
  });
}

test("E2E-01 · login administrativo → crear cliente → comprobar persistencia", async ({ page }) => {
  const database = await connectEvaluationDatabase();
  const unique = randomInt(100_000, 900_000);
  const email = `cliente-e2e-${unique}@example.invalid`;
  const rut = fixtureRut(unique);
  try {
    // Aislar la cuota persistida entre casos; el limitador real sigue habilitado.
    await database.public_request_rate_limits.deleteMany({ where: { bucket: { startsWith: "internal_login:" } } });
    await loginFromForm(page);
    await test.step("Entrar a Clientes y registrar datos sintéticos", async () => {
      await page.goto("/app/clientes");
      await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Nuevo cliente", exact: true }).click();
      for (const [label, value] of [
        ["Nombres", "ClienteEvaluable"], ["Apellidos", "Prueba Sintética"], ["RUT", rut],
        ["Teléfono", "+56912345678"], ["Correo", email], ["Dirección comercial", "Calle Sintética 789"],
      ]) await page.getByLabel(label, { exact: true }).fill(value);
      const created = page.waitForResponse((response) => response.url().endsWith("/api/customers")
        && response.request().method() === "POST");
      await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
      expect((await created).status()).toBe(201);
      await expect(page.getByRole("status").filter({ hasText: "Cliente comercial creado." })).toBeVisible();
    });
    await test.step("Recargar, buscar y abrir la ficha guardada", async () => {
      await page.reload();
      await page.getByRole("textbox", { name: "Buscar clientes" }).fill(email);
      await page.locator("form").filter({ has: page.getByRole("textbox", { name: "Buscar clientes" }) })
        .getByRole("button", { name: "Buscar", exact: true }).click();
      const entry = page.locator(".management-item").filter({ hasText: email });
      await expect(entry).toHaveCount(1);
      await entry.click();
      await expect(page.getByRole("heading", { name: "ClienteEvaluable Prueba Sintética", exact: true })).toBeVisible();
      await expect(page.getByLabel("Correo", { exact: true })).toHaveValue(email);
      await expect(page.getByLabel("RUT", { exact: true })).toHaveValue(rut);
      expect(await database.customers.count({ where: { email, rut } })).toBe(1);
    });
  } finally {
    try {
      await database.customers.deleteMany({ where: { email } });
      expect(await database.customers.count({ where: { email } })).toBe(0);
      await database.user_sessions.deleteMany({ where: { user_id: evaluation.adminId } });
    } finally { await database.$disconnect(); }
  }
});

test("E2E-02 · login administrativo → buscar pedido → detalle → cambiar estado", async ({ page }) => {
  const database = await connectEvaluationDatabase();
  try {
    // Restablecer exclusivamente el pedido sintético permite repetir el caso desde Playwright UI.
    await database.sale_events.deleteMany({ where: { sale_id: evaluation.saleId } });
    await database.sales.update({ where: { id: evaluation.saleId }, data: { status: "PAID" } });
    await database.public_request_rate_limits.deleteMany({ where: { bucket: { startsWith: "internal_login:" } } });
    await loginFromForm(page);
    await test.step("Entrar a Pedidos, buscar el pedido por cliente y consultar su detalle", async () => {
      await page.getByRole("link", { name: "Gestión de pedidos", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Gestión de pedidos" })).toBeVisible();
      await page.getByRole("textbox", { name: "Buscar pedido" }).fill("ClientePedidoEvaluacion");
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      const paid = page.getByRole("region", { name: "Pagado", exact: true });
      await expect(paid.locator(".order-card")).toHaveCount(1);
      await paid.getByRole("button", { name: "Ver detalle", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Pedido N.º 1", exact: true })).toBeVisible();
      await expect(dialog.getByText("ClientePedidoEvaluacion Sintético", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Estuche de prueba", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Pagado", { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    });
    await test.step("Iniciar preparación y verificar estado e historial después de recargar", async () => {
      const changed = page.waitForResponse((response) => response.url().endsWith(`/api/sales/${evaluation.saleId}/status`)
        && response.request().method() === "PATCH");
      await page.getByRole("region", { name: "Pagado", exact: true })
        .getByRole("button", { name: "Iniciar preparación", exact: true }).click();
      expect((await changed).status()).toBe(200);
      await expect(page.getByRole("status").filter({ hasText: "actualizado correctamente" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Pagado", exact: true }).locator(".order-card")).toHaveCount(0);
      const preparation = page.getByRole("region", { name: "En preparación", exact: true });
      await expect(preparation.locator(".order-card").filter({ hasText: "Pedido N.º 1" })).toBeVisible();
      await page.reload();
      await preparation.getByRole("button", { name: "Ver detalle", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator(".order-detail-data").getByText("En preparación", { exact: true })).toBeVisible();
      await expect(dialog.locator(".order-history")).toContainText("Pagado → En preparación");
      expect((await database.sales.findUniqueOrThrow({ where: { id: evaluation.saleId } })).status).toBe("IN_PREPARATION");
      expect(await database.sale_events.count({ where: {
        sale_id: evaluation.saleId, previous_status: "PAID", new_status: "IN_PREPARATION", performed_by: evaluation.adminId,
      } })).toBe(1);
    });
  } finally {
    try {
      await database.sale_events.deleteMany({ where: { sale_id: evaluation.saleId } });
      await database.sales.update({ where: { id: evaluation.saleId }, data: { status: "PAID", updated_by: null } });
      await database.user_sessions.deleteMany({ where: { user_id: evaluation.adminId } });
      expect((await database.sales.findUniqueOrThrow({ where: { id: evaluation.saleId } })).status).toBe("PAID");
      expect(await database.sale_events.count({ where: { sale_id: evaluation.saleId } })).toBe(0);
    } finally { await database.$disconnect(); }
  }
});
