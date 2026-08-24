import assert from "node:assert/strict";
import test from "node:test";

import { buildPosPaymentInput } from "../../src/utils/pos-payment.js";

test("conserva el medio único al registrar un segundo abono", () => {
  const form = new FormData();
  form.set("amountCents", "15000");
  form.set("reference", "segundo abono");

  assert.deepEqual(buildPosPaymentInput(form, "TRANSBANK"), {
    amountCents: 15000,
    cashReceivedCents: null,
    paymentMethod: "TRANSBANK",
    reference: "segundo abono",
  });
});

test("usa el medio seleccionado para el primer abono", () => {
  const form = new FormData();
  form.set("amountCents", "10000");
  form.set("paymentMethod", "CASH");
  form.set("cashReceivedCents", "12000");

  assert.deepEqual(buildPosPaymentInput(form), {
    amountCents: 10000,
    cashReceivedCents: 12000,
    paymentMethod: "CASH",
    reference: null,
  });
});
