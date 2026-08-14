import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  changeSaleStatus,
  confirmSale,
  createSale,
  registerSalePayment,
} from "../../src/services/sale-service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const customerId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const saleId = "00000000-0000-4000-8000-000000000004";
const draft = { customerId, items: [{ productId, quantity: 1 }] };
const actor = {
  permissions: [PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_UPDATE,
    PERMISSIONS.SALES_PAYMENTS_REGISTER],
  userId,
};

test("crea la venta como cotización", async () => {
  const sale = { id: saleId, status: "QUOTATION" };
  const result = await createSale(draft, actor, {
    createSale: async (data, actorId) => {
      assert.equal(data.prescriptionId, null); assert.equal(actorId, userId);
      return { reason: null, sale };
    },
  });
  assert.equal(result, sale);
});

test("traduce la receta obligatoria a conflicto comercial", async () => {
  await assert.rejects(() => createSale(draft, actor, {
    createSale: async () => ({ reason: "PRESCRIPTION_REQUIRED", sale: null }),
  }), (error) => error.code === "PRESCRIPTION_REQUIRED" && error.status === 409);
});

test("confirma una cotización sin aceptar un cuerpo manipulable", async () => {
  const result = await confirmSale(saleId, actor, {
    confirmSale: async (id, actorId) => ({ reason: null, sale: { id, actorId, status: "PENDING" } }),
  });
  assert.equal(result.status, "PENDING");
});

test("rechaza cambiar el medio después del primer abono", async () => {
  await assert.rejects(() => registerSalePayment(saleId, {
    amountCents: 10000, paymentMethod: "CASH",
  }, actor, {
    registerSalePayment: async () => ({ reason: "PAYMENT_METHOD_MISMATCH", sale: null }),
  }), (error) => error.code === "PAYMENT_METHOD_MISMATCH");
});

test("registra un abono con permiso específico", async () => {
  const result = await registerSalePayment(saleId, {
    amountCents: 10000, paymentMethod: "TRANSBANK", reference: "op-1",
  }, actor, {
    registerSalePayment: async (id, payment) => ({
      reason: null, sale: { id, paidCents: payment.amountCents, status: "PENDING" },
    }),
  });
  assert.equal(result.paidCents, 10000);
});

test("envía la fecha controlada al cancelar", async () => {
  const now = new Date("2026-08-14T12:00:00.000Z");
  await changeSaleStatus(saleId, { status: "CANCELLED", cancellationReason: "Error de ingreso" }, actor, {
    changeSaleStatus: async (id, change, actorId, changedAt) => {
      assert.equal(changedAt, now); assert.equal(actorId, userId);
      return { reason: null, sale: { id, status: change.status } };
    },
    currentDate: now,
  });
});
