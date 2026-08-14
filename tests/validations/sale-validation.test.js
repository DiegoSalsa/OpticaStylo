import assert from "node:assert/strict";
import test from "node:test";

import {
  validateSaleDraftInput,
  validateSalePaymentInput,
  validateSaleStatusInput,
} from "../../src/validations/sale-validation.js";

const customerId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";

test("acepta una cotización sin receta", () => {
  const result = validateSaleDraftInput({ customerId, items: [{ productId, quantity: 1 }] });
  assert.equal(result.prescriptionId, null);
});

test("impide repetir productos en una venta", () => {
  assert.throws(() => validateSaleDraftInput({
    customerId, items: [{ productId, quantity: 1 }, { productId, quantity: 2 }],
  }), /no puede repetirse/);
});

test("valida abonos enteros y medios definidos", () => {
  assert.deepEqual(validateSalePaymentInput({ amountCents: 10000, paymentMethod: "bank_transfer" }), {
    amountCents: 10000, paymentMethod: "BANK_TRANSFER", reference: null,
  });
  assert.throws(() => validateSalePaymentInput({ amountCents: 100, paymentMethod: "CARD" }), /medio de pago/);
});

test("exige motivo para cancelar y reserva estados automáticos", () => {
  assert.throws(() => validateSaleStatusInput({ status: "CANCELLED" }), /requiere un motivo/);
  assert.throws(() => validateSaleStatusInput({ status: "PAID" }), /manualmente/);
  assert.equal(validateSaleStatusInput({ status: "ready" }).status, "READY");
});
