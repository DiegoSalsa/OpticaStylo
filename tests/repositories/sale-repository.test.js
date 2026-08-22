import assert from "node:assert/strict";
import test from "node:test";

import { buildPaymentReceiptSnapshot } from "../../src/repositories/sale-repository.js";

const firstPaymentId = "00000000-0000-4000-8000-000000000001";
const secondPaymentId = "00000000-0000-4000-8000-000000000002";
const sale = {
  payments: [
    { amountCents: 20000, id: firstPaymentId, paymentMethod: "CASH" },
    { amountCents: 30000, id: secondPaymentId, paymentMethod: "CASH" },
  ],
  totalCents: 50000,
};

test("conserva el saldo histórico del comprobante de cada abono", () => {
  assert.deepEqual(buildPaymentReceiptSnapshot(sale, firstPaymentId), {
    balanceCents: 30000,
    paidCents: 20000,
    payment: sale.payments[0],
    payments: [sale.payments[0]],
    type: "PAYMENT",
  });
});

test("identifica el último abono como comprobante final", () => {
  assert.deepEqual(buildPaymentReceiptSnapshot(sale, secondPaymentId), {
    balanceCents: 0,
    paidCents: 50000,
    payment: sale.payments[1],
    payments: sale.payments,
    type: "FINAL",
  });
});

test("rechaza un abono que no pertenece a la venta", () => {
  assert.equal(
    buildPaymentReceiptSnapshot(sale, "00000000-0000-4000-8000-000000000003"),
    null,
  );
});
