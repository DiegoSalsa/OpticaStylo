import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  createMercadoPagoCheckout,
  getMercadoPagoCheckouts,
  processMercadoPagoNotification,
} from "../../src/services/mercado-pago-service.js";

const saleId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const actor = {
  permissions: [PERMISSIONS.SALES_MERCADO_PAGO_CHECKOUT, PERMISSIONS.SALES_READ],
  userId,
};
const attempt = {
  amountCents: 52000,
  checkoutUrl: null,
  expiresAt: new Date("2026-08-14T13:30:00.000Z"),
  id: "00000000-0000-4000-8000-000000000003",
  idempotencyKey: "00000000-0000-4000-8000-000000000004",
  status: "CREATED",
};
const readyConfig = {
  accessToken: "token",
  expectedLiveMode: false,
  mode: "sandbox",
  publicUrl: "https://tienda.example.com",
  webhookSecret: "secret",
};

test("crea una preferencia idempotente para el saldo reservado", async () => {
  const now = new Date("2026-08-14T13:00:00.000Z");
  const result = await createMercadoPagoCheckout(saleId, actor, {
    attachMercadoPagoPreference: async (attemptId, preference) => ({
      ...attempt, ...preference, checkoutUrl: preference.checkoutUrl,
      id: attemptId, status: "PENDING",
    }),
    createMercadoPagoPreference: async ({ attempt: receivedAttempt, sale }) => {
      assert.equal(receivedAttempt.id, attempt.id);
      assert.equal(sale.id, saleId);
      return {
        checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect",
        externalPreferenceId: "preference-1",
        sandboxCheckoutUrl: "https://sandbox.mercadopago.cl/checkout",
      };
    },
    currentDate: now,
    findSaleById: async () => ({ customer: {}, id: saleId, items: [] }),
    getMercadoPagoConfig: () => readyConfig,
    reserveMercadoPagoAttempt: async (id, actorId, expiresAt) => {
      assert.equal(id, saleId);
      assert.equal(actorId, userId);
      assert.equal(expiresAt.toISOString(), "2026-08-14T13:30:00.000Z");
      return { attempt, reason: null };
    },
  });

  assert.equal(result.status, "PENDING");
  assert.equal(result.externalPreferenceId, "preference-1");
});

test("reutiliza un checkout pendiente sin crear otra preferencia", async () => {
  const existing = { ...attempt, checkoutUrl: "https://checkout.example", status: "PENDING" };
  const result = await createMercadoPagoCheckout(saleId, actor, {
    createMercadoPagoPreference: async () => assert.fail("No debe duplicar la preferencia"),
    findSaleById: async () => ({ customer: {}, id: saleId }),
    getMercadoPagoConfig: () => readyConfig,
    reserveMercadoPagoAttempt: async () => ({ attempt: existing, reason: null }),
  });
  assert.equal(result.checkoutUrl, existing.checkoutUrl);
  assert.equal("idempotencyKey" in result, false);
});

test("marca el intento fallido cuando el proveedor no responde", async () => {
  let markedAttemptId = null;
  await assert.rejects(() => createMercadoPagoCheckout(saleId, actor, {
    createMercadoPagoPreference: async () => { throw new Error("timeout"); },
    findSaleById: async () => ({ customer: {}, id: saleId, items: [] }),
    getMercadoPagoConfig: () => readyConfig,
    markPaymentAttemptFailed: async (id) => { markedAttemptId = id; },
    reserveMercadoPagoAttempt: async () => ({ attempt, reason: null }),
  }), (error) => error.code === "PAYMENT_PROVIDER_UNAVAILABLE" && error.status === 502);
  assert.equal(markedAttemptId, attempt.id);
});

test("no reserva un intento si el webhook seguro no está listo", async () => {
  await assert.rejects(() => createMercadoPagoCheckout(saleId, actor, {
    getMercadoPagoConfig: () => ({
      accessToken: "token",
      mode: "sandbox",
      publicUrl: "https://tienda.example.com",
      webhookSecret: null,
    }),
    reserveMercadoPagoAttempt: async () => assert.fail("No debe reservar un cobro"),
  }), (error) => error.code === "PAYMENT_PROVIDER_NOT_CONFIGURED" && error.status === 503);
});

test("no crea un checkout para una venta sin cliente registrado", async () => {
  await assert.rejects(() => createMercadoPagoCheckout(saleId, actor, {
    findSaleById: async () => ({ customer: null, id: saleId }),
    getMercadoPagoConfig: () => readyConfig,
    reserveMercadoPagoAttempt: async () => assert.fail("No debe reservar un cobro sin cliente"),
  }), (error) => error.code === "CUSTOMER_REQUIRED_FOR_MERCADO_PAGO" && error.status === 409);
});

test("lista intentos solo con permiso de lectura de ventas", async () => {
  const result = await getMercadoPagoCheckouts(saleId, actor, {
    findSaleById: async () => ({ id: saleId }),
    listPaymentAttemptsBySaleId: async () => [attempt],
  });
  assert.equal(result[0].id, attempt.id);
  assert.equal("idempotencyKey" in result[0], false);
});

test("verifica firma, consulta al proveedor y reconcilia el pago", async () => {
  let signatureChecked = false;
  const result = await processMercadoPagoNotification({
    body: { action: "payment.updated", data: { id: "123" }, type: "payment" },
    requestId: "request-1",
    signature: "ts=1,v1=firma",
  }, {
    auditWebhook: () => {},
    findPaymentConfirmationKey: async () => null,
    getMercadoPagoConfig: () => ({ accessToken: "token", webhookSecret: "secret" }),
    getMercadoPagoPayment: async (id) => ({ externalPaymentId: id, status: "approved" }),
    reconcileMercadoPagoPayment: async (notification, payment) => {
      assert.equal(notification.dataId, "123");
      assert.equal(payment.status, "approved");
      return { result: "APPROVED" };
    },
    requireWebhookSecret: () => "secret",
    validateSignature: ({ dataId, secret }) => {
      assert.equal(dataId, "123"); assert.equal(secret, "secret");
      signatureChecked = true;
    },
  });
  assert.equal(signatureChecked, true);
  assert.equal(result.result, "APPROVED");
});

test("rechaza una firma inválida antes de consultar el pago", async () => {
  await assert.rejects(() => processMercadoPagoNotification({
    body: { action: "payment.created", data: { id: "123" }, type: "payment" },
    requestId: "request-1",
    signature: "firma-invalida",
  }, {
    auditWebhook: () => {},
    getMercadoPagoConfig: () => ({ webhookSecret: "secret" }),
    getMercadoPagoPayment: async () => assert.fail("No debe consultar el pago"),
    requireWebhookSecret: () => "secret",
    validateSignature: () => { throw new Error("invalid"); },
  }), (error) => error.code === "INVALID_PAYMENT_NOTIFICATION_SIGNATURE" && error.status === 401);
});

test("un webhook repetido no entrega correo dentro de la solicitud de pago", async () => {
  const result = await processMercadoPagoNotification({
    body: { action: "payment.updated", data: { id: "123" }, type: "payment" },
    requestId: "request-repeated",
    signature: "ts=1,v1=firma",
  }, {
    auditWebhook: () => {},
    getMercadoPagoConfig: () => ({
      accessToken: "token",
      expectedLiveMode: false,
      webhookSecret: "secret",
    }),
    getMercadoPagoPayment: async () => ({ externalPaymentId: "123", status: "approved" }),
    reconcileMercadoPagoPayment: async () => ({
      duplicate: true,
      result: "ALREADY_PROCESSED",
    }),
    requireWebhookSecret: () => "secret",
    validateSignature: () => {},
  });
  assert.equal(result.emailQueued, false);
  assert.equal(Object.hasOwn(result, "emailDelivery"), false);
});
