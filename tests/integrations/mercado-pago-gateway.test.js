import assert from "node:assert/strict";
import test from "node:test";

import {
  createMercadoPagoPreferenceBody,
  resolveExternalPreferenceId,
  selectMercadoPagoCheckoutUrl,
} from "../../src/integrations/payments/mercado-pago-gateway.js";

const input = {
  attempt: {
    amountCents: 49990,
    expiresAt: new Date("2026-08-22T04:30:00.000Z"),
    id: "00000000-0000-4000-8000-000000000001",
  },
  config: { publicUrl: "https://tienda.example.com" },
  sale: {
    customer: { email: "ana@example.com", firstNames: "Ana", lastNames: "Pérez" },
    id: "00000000-0000-4000-8000-000000000002",
    items: [{ quantity: 9, unitPriceCents: 1 }],
    saleNumber: 42,
  },
};

test("crea una preferencia por el saldo exacto reservado", () => {
  const body = createMercadoPagoPreferenceBody(input);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].quantity, 1);
  assert.equal(body.items[0].unit_price, input.attempt.amountCents);
  assert.equal(body.external_reference, input.attempt.id);
  assert.equal(body.metadata.sale_id, input.sale.id);
});

test("omite los datos del pagador en una venta rápida sin cliente", () => {
  const body = createMercadoPagoPreferenceBody({
    ...input,
    sale: { ...input.sale, customer: null },
  });
  assert.equal(Object.hasOwn(body, "payer"), false);
});

test("configura retornos y webhook sin usar la URL como confirmación", () => {
  const body = createMercadoPagoPreferenceBody(input);
  assert.equal(body.auto_return, "approved");
  assert.equal(body.back_urls.success, "https://tienda.example.com/checkout/mercado-pago/success");
  assert.equal(body.notification_url, "https://tienda.example.com/api/webhooks/mercado-pago?source_news=webhooks");
});

test("usa el checkout principal también para compras con usuarios de prueba", () => {
  assert.equal(selectMercadoPagoCheckoutUrl({
    init_point: "https://www.mercadopago.cl/checkout",
    sandbox_init_point: "https://sandbox.mercadopago.cl/checkout",
  }), "https://www.mercadopago.cl/checkout");
});

test("recupera la preferencia exacta desde la orden comercial cuando el pago la omite", () => {
  assert.equal(resolveExternalPreferenceId(
    { preference_id: null },
    { preference_id: "pref-exacta" },
  ), "pref-exacta");
  assert.equal(resolveExternalPreferenceId(
    { preference_id: "pref-del-pago" },
    { preference_id: "pref-de-la-orden" },
  ), "pref-del-pago");
});
