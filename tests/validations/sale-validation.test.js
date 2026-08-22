import assert from "node:assert/strict";
import test from "node:test";

import {
  validateSaleDraftInput,
  validateSalePaymentInput,
  validateSaleStatusInput,
} from "../../src/validations/sale-validation.js";

const customerId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const patientId = "00000000-0000-4000-8000-000000000005";
const discountAuthorization = {
  authorizerEmail: "admin@opticastylo.cl",
  authorizerPassword: "Una-clave-segura-2026",
};

test("acepta una cotización sin receta", () => {
  const result = validateSaleDraftInput({
    customerId,
    items: [{ productId, quantity: 1 }],
  });
  assert.equal(result.prescriptionId, null);
  assert.equal(result.discountCents, 0);
  assert.equal(result.discountReason, null);
  assert.equal(result.externalPrescriptionId, null);
});

test("acepta una receta externa pero nunca junto con una interna", () => {
  const externalPrescriptionId = "00000000-0000-4000-8000-000000000003";
  const result = validateSaleDraftInput({
    customerId,
    externalPrescriptionId,
    items: [{ productId, quantity: 1 }],
    patientId,
  });
  assert.equal(result.externalPrescriptionId, externalPrescriptionId);
  assert.throws(
    () =>
      validateSaleDraftInput({
        customerId,
        externalPrescriptionId,
        items: [{ productId, quantity: 1 }],
        patientId,
        prescriptionId: "00000000-0000-4000-8000-000000000004",
      }),
    /no ambas/,
  );
});

test("normaliza un descuento manual con motivo auditable", () => {
  const result = validateSaleDraftInput({
    customerId,
    discount: {
      amountCents: 5000,
      reason: "  Convenio   empresa  ",
      ...discountAuthorization,
    },
    items: [{ productId, quantity: 1 }],
  });
  assert.equal(result.discountCents, 5000);
  assert.equal(result.discountReason, "Convenio empresa");
  assert.equal(result.discount.authorizerEmail, "admin@opticastylo.cl");
});

test("rechaza descuentos sin motivo y motivos sin descuento", () => {
  assert.throws(
    () =>
      validateSaleDraftInput({
        customerId,
        discount: { amountCents: 5000, ...discountAuthorization },
        items: [{ productId, quantity: 1 }],
      }),
    /requiere un motivo/,
  );
  assert.throws(
    () =>
      validateSaleDraftInput({
        customerId,
        discountReason: "Convenio",
        items: [{ productId, quantity: 1 }],
      }),
    /solo corresponde/,
  );
});

test("normaliza adicionales ópticos como cargos separados", () => {
  const result = validateSaleDraftInput({
    customerId,
    items: [{ productId, quantity: 1 }],
    opticalAdditions: [{
      description: "  Capa de alta resistencia  ",
      name: "  Antirreflejo premium  ",
      quantity: 1,
      unitPriceCents: 39990,
    }],
  });
  assert.deepEqual(result.opticalAdditions, [{
    description: "Capa de alta resistencia",
    name: "Antirreflejo premium",
    quantity: 1,
    unitPriceCents: 39990,
  }]);
});

test("impide repetir productos en una venta", () => {
  assert.throws(
    () =>
      validateSaleDraftInput({
        customerId,
        items: [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ],
      }),
    /no puede repetirse/,
  );
});

test("valida abonos enteros y medios definidos", () => {
  assert.deepEqual(
    validateSalePaymentInput({
      amountCents: 10000,
      paymentMethod: "bank_transfer",
    }),
    {
      amountCents: 10000,
      paymentMethod: "BANK_TRANSFER",
      reference: null,
    },
  );
  assert.throws(
    () => validateSalePaymentInput({ amountCents: 100, paymentMethod: "CARD" }),
    /medio de pago/,
  );
});

test("exige motivo para cancelar y reserva estados automáticos", () => {
  assert.throws(
    () => validateSaleStatusInput({ status: "CANCELLED" }),
    /requiere un motivo/,
  );
  assert.throws(
    () => validateSaleStatusInput({ status: "PAID" }),
    /manualmente/,
  );
  assert.equal(validateSaleStatusInput({ status: "ready" }).status, "READY");
});
