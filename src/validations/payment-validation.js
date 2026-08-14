import { AppError } from "../utils/app-error.js";

function fail(message) {
  throw new AppError({
    code: "INVALID_PAYMENT_NOTIFICATION",
    message,
    status: 400,
  });
}

function requiredText(value, label, maximumLength) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximumLength) {
    fail(`${label} no es válido.`);
  }
  return normalized;
}

export function validateMercadoPagoNotification({
  body,
  dataId,
  requestId,
  signature,
}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("El cuerpo de la notificación no es válido.");
  }
  if (body.type !== "payment" || !String(body.action ?? "").startsWith("payment.")) {
    fail("La notificación no corresponde a un pago.");
  }

  const normalizedDataId = requiredText(dataId ?? body.data?.id, "El identificador del pago", 200);
  if (!/^\d+$/.test(normalizedDataId)) {
    fail("El identificador del pago no es válido.");
  }

  return {
    dataId: normalizedDataId,
    eventType: requiredText(body.action, "El tipo de evento", 100),
    payload: body,
    requestId: requiredText(requestId, "x-request-id", 200),
    signature: requiredText(signature, "x-signature", 500),
  };
}
