import assert from "node:assert/strict";
import test from "node:test";

import { createMercadoPagoPreferenceBody } from "../../src/integrations/payments/mercado-pago-gateway.js";

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

test("configura retornos y webhook sin usar la URL como confirmación", () => {
  const body = createMercadoPagoPreferenceBody(input);
  assert.equal(body.auto_return, "approved");
  assert.equal(body.back_urls.success, "https://tienda.example.com/checkout/mercado-pago/success");
  assert.equal(body.notification_url, "https://tienda.example.com/api/webhooks/mercado-pago?source_news=webhooks");
});
