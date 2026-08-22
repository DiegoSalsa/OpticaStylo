export function buildPosPaymentInput(formData, existingPaymentMethod = null) {
  return {
    amountCents: Number(formData.get("amountCents")),
    paymentMethod: existingPaymentMethod ?? formData.get("paymentMethod"),
    reference: formData.get("reference") || null,
  };
}
