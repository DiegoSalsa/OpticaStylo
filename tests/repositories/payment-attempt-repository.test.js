import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidPaymentExternalReference,
  paymentMatchesAttempt,
} from "../../src/repositories/payment-attempt-repository.js";

const attempt = {
  amount_cents: 52000,
  currency: "CLP",
  external_preference_id: "preference-1",
};

const payment = {
  currency: "CLP",
  externalPreferenceId: "preference-1",
  transactionAmount: 52000,
};

test("acepta una referencia externa con formato UUID", () => {
  assert.equal(
    isValidPaymentExternalReference("00000000-0000-4000-8000-000000000001"),
    true,
  );
});

test("ignora referencias externas que no pueden consultar el intento", () => {
  assert.equal(isValidPaymentExternalReference("referencia-controlada-por-tercero"), false);
  assert.equal(isValidPaymentExternalReference(null), false);
});

test("concilia solamente monto, moneda y preferencia exactos", () => {
  assert.equal(paymentMatchesAttempt(attempt, payment), true);
  assert.equal(paymentMatchesAttempt(attempt, { ...payment, transactionAmount: 51000 }), false);
  assert.equal(paymentMatchesAttempt(attempt, { ...payment, currency: "USD" }), false);
});

test("falla de forma cerrada si Mercado Pago no informa la preferencia", () => {
  assert.equal(paymentMatchesAttempt(attempt, { ...payment, externalPreferenceId: null }), false);
});
