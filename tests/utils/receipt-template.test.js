import assert from "node:assert/strict";
import test from "node:test";

import { renderReceiptHtml } from "../../src/utils/receipt-template.js";

test("identifica una venta sin cliente registrado en el comprobante", () => {
  const html = renderReceiptHtml({
    issuedAt: new Date("2026-08-23T12:00:00.000Z"),
    payload: {
      balanceCents: 0,
      customer: null,
      items: [{ lineTotalCents: 50000, name: "Montura", quantity: 1, sku: "MARCO-1", unitPriceCents: 50000 }],
      paidCents: 50000,
      patient: null,
      saleNumber: 42,
      subtotalCents: 50000,
      totalCents: 50000,
    },
    receiptNumber: 9,
    type: "FINAL",
  }, { document: false });

  assert.match(html, /Venta sin cliente registrado/);
  assert.match(html, /No informado/);
});
