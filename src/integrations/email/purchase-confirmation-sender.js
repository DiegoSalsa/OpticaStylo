import { renderReceiptHtml } from "../../utils/receipt-template.js";

export async function sendPurchaseConfirmation(receipt, dependencies = {}) {
  const apiKey = dependencies.apiKey ?? process.env.RESEND_API_KEY;
  const from = dependencies.from ?? process.env.POS_EMAIL_FROM;
  const fetcher = dependencies.fetch ?? fetch;

  if (!apiKey || !from) {
    return { providerId: null, status: "SIMULATED" };
  }

  const response = await fetcher("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html: renderReceiptHtml(receipt),
      subject: `Compra confirmada · Óptica Stylo · Venta #${receipt.payload.saleNumber}`,
      to: [receipt.emailedTo],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `optica-stylo-receipt-${receipt.id}`,
      "User-Agent": "OpticaStylo-POS/1.0",
    },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    const message = payload.message ?? payload.error ?? `Resend respondió ${response.status}.`;
    throw new Error(String(message).slice(0, 500));
  }
  return { providerId: payload.id, status: "SENT" };
}
