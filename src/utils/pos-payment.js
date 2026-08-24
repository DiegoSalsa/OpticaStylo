export function buildPosPaymentInput(formData, existingPaymentMethod = null) {
  const paymentMethod = existingPaymentMethod ?? formData.get("paymentMethod");
  const amountCents = Number(formData.get("amountCents"));
  return {
    amountCents,
    cashReceivedCents:
      paymentMethod === "CASH" ? Number(formData.get("cashReceivedCents")) : null,
    paymentMethod,
    reference: formData.get("reference") || null,
  };
}
