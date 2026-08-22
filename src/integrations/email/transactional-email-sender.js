function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatClp(value) {
  return new Intl.NumberFormat("es-CL", {
    currency: "CLP",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function renderPaymentConfirmed(email) {
  const saleNumber = escapeHtml(email.payload.saleNumber ?? email.payload.saleId);
  const amount = escapeHtml(formatClp(email.payload.amountCents));
  return {
    html: `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#17352f;line-height:1.6"><main style="max-width:600px;margin:auto;padding:32px"><p style="color:#08705d;font-weight:700">Optica Stylo</p><h1>Pago confirmado</h1><p>Mercado Pago confirmo de forma segura el pago de tu compra.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:12px 0;border-top:1px solid #dbe7e3">Pedido</td><td style="padding:12px 0;border-top:1px solid #dbe7e3;text-align:right;font-weight:700">N. ${saleNumber}</td></tr><tr><td style="padding:12px 0;border-top:1px solid #dbe7e3">Monto confirmado</td><td style="padding:12px 0;border-top:1px solid #dbe7e3;text-align:right;font-weight:700">${amount}</td></tr></table><p>Conserva este correo como confirmacion. El pedido solo fue marcado como pagado despues de conciliar el webhook firmado.</p></main></body></html>`,
    subject: `Pago confirmado - Optica Stylo - Pedido ${saleNumber}`,
  };
}

export async function sendTransactionalEmail(email, dependencies = {}) {
  const apiKey = dependencies.apiKey ?? process.env.RESEND_API_KEY;
  const from = dependencies.from ?? process.env.POS_EMAIL_FROM;
  const fetcher = dependencies.fetch ?? fetch;
  if (!apiKey || !from) {
    throw new Error("El proveedor de correo transaccional no esta configurado.");
  }
  if (email.templateCode !== "PAYMENT_CONFIRMED") {
    throw new Error(`La plantilla ${email.templateCode} no esta habilitada para envio automatico.`);
  }

  const content = renderPaymentConfirmed(email);
  const response = await fetcher("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html: content.html,
      subject: content.subject,
      to: [email.recipientEmail],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `optica-stylo-outbox-${email.id}`,
      "User-Agent": "OpticaStylo-Checkout/1.0",
    },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    const message = payload.message ?? payload.error ?? `Resend respondio ${response.status}.`;
    throw new Error(String(message).slice(0, 500));
  }
  return { providerId: payload.id, status: "SENT" };
}
