const PREFIXES = Object.freeze({
  ACCOUNT_CREATED: "account",
  APPOINTMENT_CONFIRMED: "appointment-confirmed",
  APPOINTMENT_REMINDER: "appointment-reminder",
  ORDER_CONFIRMED: "order-confirmed",
  PAYMENT_CONFIRMED: "payment-confirmed",
  POS_FINAL_RECEIPT: "receipt-final",
  POS_PAYMENT_RECEIPT: "receipt-payment",
});

export function transactionalEmailDeduplicationKey(templateCode, entityId) {
  const prefix = PREFIXES[templateCode];
  if (!prefix || typeof entityId !== "string" || !entityId.trim()) {
    throw new Error("No se puede construir la clave del correo transaccional.");
  }
  return `${prefix}:${entityId.trim().toLowerCase()}`;
}

