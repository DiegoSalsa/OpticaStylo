import assert from "node:assert/strict";
import test from "node:test";

import {
  validateReceiptInput,
  validateSaleDraftInput,
  validateSalePaymentInput,
  validateSaleStatusInput,
} from "../../src/validations/sale-validation.js";

const customerId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const frameProductId = "00000000-0000-4000-8000-000000000007";
const patientId = "00000000-0000-4000-8000-000000000005";
const discountAuthorization = {
  authorizationId: "00000000-0000-4000-8000-000000000009",
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

test("normaliza la montura vendida de unos cristales", () => {
  const result = validateSaleDraftInput({
    customerId,
    items: [
      { productId: frameProductId, quantity: 1 },
      {
        mount: { frameProductId, source: "sold_frame" },
        productId,
        quantity: 2,
      },
    ],
  });
  assert.deepEqual(result.items[1].mount, {
    frameProductId,
    source: "SOLD_FRAME",
  });
});

test("admite montura del cliente y rechaza referencias incompatibles", () => {
  const result = validateSaleDraftInput({
    customerId,
    items: [{
      mount: { source: "CUSTOMER_FRAME" },
      productId,
      quantity: 1,
    }],
  });
  assert.deepEqual(result.items[0].mount, {
    frameProductId: null,
    source: "CUSTOMER_FRAME",
  });
  assert.throws(
    () => validateSaleDraftInput({
      customerId,
      items: [{
        mount: { frameProductId, source: "CUSTOMER_FRAME" },
        productId,
        quantity: 1,
      }],
    }),
    /no debe apuntar a un producto/,
  );
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
  assert.equal(result.discount.authorizationId, discountAuthorization.authorizationId);
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

test("rechaza adicionales ópticos de precio libre", () => {
  assert.throws(() => validateSaleDraftInput({
    customerId,
    items: [{ productId, quantity: 1 }],
    opticalAdditions: [{ name: "Adicional libre", quantity: 1, unitPriceCents: 39990 }],
  }), /catálogo/);
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
      reference: "TRX-PRUEBA-1",
    }),
    {
      amountCents: 10000,
      cashReceivedCents: null,
      changeCents: null,
      paymentMethod: "BANK_TRANSFER",
      reference: "TRX-PRUEBA-1",
    },
  );
  assert.throws(
    () => validateSalePaymentInput({ amountCents: 100, paymentMethod: "CARD" }),
    /medio de pago/,
  );
});

test("calcula vuelto solo para efectivo y bloquea Mercado Pago manual", () => {
  assert.deepEqual(validateSalePaymentInput({
    amountCents: 15000,
    cashReceivedCents: 20000,
    paymentMethod: "CASH",
  }), {
    amountCents: 15000,
    cashReceivedCents: 20000,
    changeCents: 5000,
    paymentMethod: "CASH",
    reference: null,
  });
  assert.throws(
    () => validateSalePaymentInput({ amountCents: 15000, paymentMethod: "MERCADO_PAGO" }),
    /checkout y webhook seguro/,
  );
});

test("vincula el comprobante con el abono normalizado", () => {
  const paymentId = "00000000-0000-4000-8000-000000000006";
  assert.deepEqual(validateReceiptInput({
    email: " Cliente@Example.com ",
    paymentId,
  }), {
    email: "cliente@example.com",
    paymentId,
  });
  assert.throws(
    () => validateReceiptInput({ paymentId: "abono-inválido" }),
    /abono no es válido/,
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
