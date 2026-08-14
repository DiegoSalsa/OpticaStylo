import assert from "node:assert/strict";
import test from "node:test";

import { validateMercadoPagoNotification } from "../../src/validations/payment-validation.js";

const body = {
  action: "payment.updated",
  data: { id: "123456" },
  type: "payment",
};

test("normaliza una notificación de pago", () => {
  const result = validateMercadoPagoNotification({
    body,
    requestId: " request-1 ",
    signature: "ts=1,v1=firma",
  });

  assert.equal(result.dataId, "123456");
  assert.equal(result.eventType, "payment.updated");
  assert.equal(result.requestId, "request-1");
});

test("prioriza data.id firmado desde la URL", () => {
  const result = validateMercadoPagoNotification({
    body,
    dataId: "999",
    requestId: "request-1",
    signature: "ts=1,v1=firma",
  });
  assert.equal(result.dataId, "999");
});

test("rechaza eventos que no son pagos", () => {
  assert.throws(() => validateMercadoPagoNotification({
    body: { action: "merchant_order.updated", data: { id: "1" }, type: "merchant_order" },
    requestId: "request-1",
    signature: "ts=1,v1=firma",
  }), /no corresponde a un pago/);
});

test("exige los encabezados usados en la firma", () => {
  assert.throws(() => validateMercadoPagoNotification({ body }), /x-request-id/);
});
