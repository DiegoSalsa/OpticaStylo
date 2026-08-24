import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  changeSaleStatus,
  confirmSale,
  createSale,
  grantDiscountAuthorization,
  issueSaleReceipt,
  registerSalePayment,
  updateSaleDraft,
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
const allowedDiscountAttempt = {
  beginDiscountAuthorizationAttempt: async () => ({
    allowed: true,
    attemptId: "00000000-0000-4000-8000-000000000007",
  }),
  completeDiscountAuthorizationAttempt: async () => {},
};

test("crea la venta como cotización", async () => {
  const sale = { id: saleId, status: "QUOTATION" };
  const result = await createSale(draft, actor, {
    createSale: async (data, actorId) => {
      assert.equal(data.prescriptionId, null); assert.equal(actorId, userId);
      assert.equal(data.discountCents, 0);
      return { reason: null, sale };
    },
  });
  assert.equal(result, sale);
});

test("crea una venta directa pendiente de cobro sin una confirmación intermedia", async () => {
  const result = await createSale({ ...draft, operation: "SALE" }, actor, {
    createSale: async (data, actorId, options) => {
      assert.equal(data.customerId, customerId);
      assert.equal(actorId, userId);
      assert.equal(options.status, "PENDING");
      return { reason: null, sale: { id: saleId, status: "PENDING" } };
    },
  });
  assert.equal(result.status, "PENDING");
});

test("permite crear una venta de cristales sin adjuntar receta", async () => {
  const result = await createSale({
    ...draft,
    items: [{
      mount: { frameProductId: productId, source: "SOLD_FRAME" },
      productId,
      quantity: 1,
    }],
  }, actor, {
    createSale: async (data) => {
      assert.equal(data.patientId, null);
      assert.equal(data.prescriptionId, null);
      assert.equal(data.externalPrescriptionId, null);
      return { reason: null, sale: { id: saleId, status: "QUOTATION" } };
    },
  });
  assert.equal(result.status, "QUOTATION");
});

test("normaliza una venta directa de solo marco sin cliente registrado", async () => {
  const result = await createSale({
    customerId: null,
    items: [{ productId, quantity: 1 }],
    operation: "SALE",
  }, actor, {
    createSale: async (data, actorId, options) => {
      assert.equal(data.customerId, null);
      assert.equal(actorId, userId);
      assert.equal(options.status, "PENDING");
      return { reason: null, sale: { id: saleId, status: "PENDING" } };
    },
  });
  assert.equal(result.status, "PENDING");
});

test("traduce el rechazo de una venta sin cliente que no es solo de monturas", async () => {
  await assert.rejects(() => createSale({
    customerId: null,
    items: [{ productId, quantity: 1 }],
  }, actor, {
    createSale: async () => ({ reason: "CUSTOMER_REQUIRED_FOR_SALE_DETAILS", sale: null }),
  }), (error) => error.code === "CUSTOMER_REQUIRED_FOR_SALE_DETAILS" && error.status === 409);
});

test("confirma una cotización sin adjuntar receta", async () => {
  const result = await confirmSale(saleId, actor, {
    confirmSale: async (id, actorId) => {
      assert.equal(id, saleId);
      assert.equal(actorId, userId);
      return { reason: null, sale: { id: saleId, status: "PENDING" } };
    },
  });
  assert.equal(result.status, "PENDING");
});

test("traduce el rechazo de cristales sin montura a conflicto comercial", async () => {
  await assert.rejects(() => createSale(draft, actor, {
    createSale: async () => ({ reason: "LENS_MOUNT_REQUIRED", sale: null }),
  }), (error) => error.code === "LENS_MOUNT_REQUIRED" && error.status === 409);
});

test("traduce un descuento inválido a conflicto comercial", async () => {
  await assert.rejects(() => createSale({
    ...draft,
    discount: {
      amountCents: 1000,
      authorizationId: "00000000-0000-4000-8000-000000000005",
      reason: "Convenio",
    },
  }, actor, {
    ...allowedDiscountAttempt,
    createSale: async () => ({ reason: "DISCOUNT_EXCEEDS_SUBTOTAL", sale: null }),
    findDiscountAuthorizer: async () => ({
      id: "00000000-0000-4000-8000-000000000005",
      isActive: true,
      lockedUntil: null,
      passwordHash: "hash",
    }),
    verifyPassword: async () => true,
  }), (error) => error.code === "DISCOUNT_EXCEEDS_SUBTOTAL" && error.status === 409);
});

test("rechaza una autorización sin permiso de supervisor", async () => {
  await assert.rejects(() => grantDiscountAuthorization({
    amountCents: 1000,
    authorizerEmail: "ventas@opticastylo.cl",
    authorizerPassword: "clave",
    reason: "Convenio",
  }, actor, {
    ...allowedDiscountAttempt,
    findDiscountAuthorizer: async () => null,
    verifyPassword: async () => assert.fail("No debe validar una cuenta inexistente"),
  }), (error) => error.code === "DISCOUNT_AUTHORIZATION_FAILED" && error.status === 403);
});

test("otorga una autorización temporal de descuento auditada", async () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const authorization = await grantDiscountAuthorization({
    amountCents: 1000,
    authorizerEmail: "admin@opticastylo.cl",
    authorizerPassword: "clave",
    reason: "Convenio de prueba",
  }, actor, {
    ...allowedDiscountAttempt,
    createDiscountAuthorizationGrant: async (input) => {
      assert.equal(input.amountCents, 1000);
      assert.equal(input.authorizedBy, "00000000-0000-4000-8000-000000000009");
      assert.equal(input.requestedBy, userId);
      assert.equal(input.reason, "Convenio de prueba");
      assert.equal(input.expiresAt.toISOString(), "2026-08-23T12:05:00.000Z");
      return { id: "00000000-0000-4000-8000-000000000010" };
    },
    currentDate: now,
    findDiscountAuthorizer: async () => ({
      id: "00000000-0000-4000-8000-000000000009",
      isActive: true,
      lockedUntil: null,
      passwordHash: "hash",
    }),
    verifyPassword: async () => true,
  });
  assert.equal(authorization.id, "00000000-0000-4000-8000-000000000010");
});

test("limita los intentos repetidos de autorización de descuentos", async () => {
  await assert.rejects(() => grantDiscountAuthorization({
    amountCents: 1000,
    authorizerEmail: "admin@opticastylo.cl",
    authorizerPassword: "clave",
    reason: "Convenio",
  }, actor, {
    beginDiscountAuthorizationAttempt: async ({ attemptedBy, authorizerEmail }) => {
      assert.equal(attemptedBy, userId);
      assert.equal(authorizerEmail, "admin@opticastylo.cl");
      return { allowed: false, attemptId: "00000000-0000-4000-8000-000000000008" };
    },
    completeDiscountAuthorizationAttempt: async () => assert.fail("No debe completar un intento bloqueado"),
    findDiscountAuthorizer: async () => assert.fail("No debe consultar credenciales al estar bloqueado"),
  }), (error) => error.code === "DISCOUNT_AUTHORIZATION_RATE_LIMITED" && error.status === 429);
});

test("confirma una cotización sin aceptar un cuerpo manipulable", async () => {
  const result = await confirmSale(saleId, actor, {
    confirmSale: async (id, actorId) => ({ reason: null, sale: { id, actorId, status: "PENDING" } }),
  });
  assert.equal(result.status, "PENDING");
});

test("permite editar una cotización vigente antes de confirmarla", async () => {
  const result = await updateSaleDraft(saleId, draft, actor, {
    updateSaleDraft: async (id, normalizedDraft, actorId) => {
      assert.equal(id, saleId);
      assert.equal(normalizedDraft.customerId, customerId);
      assert.equal(actorId, userId);
      return { reason: null, sale: { id, status: "QUOTATION" } };
    },
  });
  assert.equal(result.status, "QUOTATION");
});

test("rechaza cambiar el medio después del primer abono", async () => {
  await assert.rejects(() => registerSalePayment(saleId, {
    amountCents: 10000, cashReceivedCents: 10000, paymentMethod: "CASH",
  }, actor, {
    registerSalePayment: async () => ({ reason: "PAYMENT_METHOD_MISMATCH", sale: null }),
  }), (error) => error.code === "PAYMENT_METHOD_MISMATCH");
});

test("exige una caja abierta antes de registrar efectivo", async () => {
  await assert.rejects(() => registerSalePayment(saleId, {
    amountCents: 10000,
    cashReceivedCents: 12000,
    paymentMethod: "CASH",
  }, actor, {
    registerSalePayment: async () => ({ reason: "CASH_REGISTER_CLOSED", sale: null }),
  }), (error) => error.code === "CASH_REGISTER_CLOSED" && error.status === 409);
});

test("exige permiso de ventas para crear una operación", async () => {
  await assert.rejects(() => createSale(draft, {
    permissions: [],
    userId,
  }), (error) => error.code === "INSUFFICIENT_PERMISSIONS");
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

test("conserva una clave de reintento para no duplicar un abono", async () => {
  const result = await registerSalePayment(saleId, {
    amountCents: 10000, paymentMethod: "TRANSBANK", reference: "op-1",
  }, actor, {
    registerSalePayment: async (id, payment, actorId, options) => {
      assert.equal(id, saleId);
      assert.equal(payment.reference, "op-1");
      assert.equal(actorId, userId);
      assert.equal(options.requestKey, "pago-prueba-0001");
      return { reason: null, sale: { id, paidCents: payment.amountCents, status: "PENDING" } };
    },
    requestKey: "pago-prueba-0001",
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

test("emite el comprobante encolado sin contactar al proveedor", async () => {
  const pendingReceipt = {
    emailStatus: "PENDING",
    emailedTo: "cliente@example.com",
    id: "00000000-0000-4000-8000-000000000006",
  };
  const result = await issueSaleReceipt(
    saleId,
    { email: " Cliente@Example.com " },
    { permissions: [PERMISSIONS.SALES_READ], userId },
    {
      issueSaleReceipt: async (id, receiptInput, actorId) => {
        assert.equal(id, saleId);
        assert.deepEqual(receiptInput, {
          email: "cliente@example.com",
          paymentId: null,
        });
        assert.equal(actorId, userId);
        return { reason: null, receipt: pendingReceipt };
      },
    },
  );
  assert.equal(result.emailStatus, "PENDING");
  assert.equal(result, pendingReceipt);
});
