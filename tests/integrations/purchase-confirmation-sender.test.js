import assert from "node:assert/strict";
import test from "node:test";

import { sendPurchaseConfirmation } from "../../src/integrations/email/purchase-confirmation-sender.js";

const receipt = {
  emailedTo: "cliente@example.com",
  id: "00000000-0000-4000-8000-000000000001",
  issuedAt: "2026-08-21T18:00:00.000Z",
  payload: {
    additions: [],
    balanceCents: 0,
    customer: { firstNames: "Ana", lastNames: "Pérez", rut: "12345678-5" },
    discount: null,
    items: [{ lineTotalCents: 49990, name: "Marco", quantity: 1, sku: "M-1", unitPriceCents: 49990 }],
    paidCents: 49990,
    patient: null,
    saleNumber: 42,
    subtotalCents: 49990,
    totalCents: 49990,
  },
  receiptNumber: 7,
};

test("simula el envío cuando Resend no está configurado", async () => {
  assert.deepEqual(await sendPurchaseConfirmation(receipt, {
    apiKey: "",
    from: "",
    fetch: async () => assert.fail("No debe llamar al proveedor"),
  }), { providerId: null, status: "SIMULATED" });
});

test("envía un comprobante idempotente mediante Resend", async () => {
  const result = await sendPurchaseConfirmation(receipt, {
    apiKey: "re_test",
    from: "Optica Stylo <ventas@example.com>",
    fetch: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options.headers.Authorization, "Bearer re_test");
      assert.equal(options.headers["Idempotency-Key"], `optica-stylo-receipt-${receipt.id}`);
      const body = JSON.parse(options.body);
      assert.deepEqual(body.to, [receipt.emailedTo]);
      assert.match(body.html, /Comprobante de venta/);
      return { json: async () => ({ id: "email-1" }), ok: true, status: 200 };
    },
  });
  assert.deepEqual(result, { providerId: "email-1", status: "SENT" });
});
