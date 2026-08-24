const CURRENCY = new Intl.NumberFormat("es-CL", {
  currency: "CLP",
  maximumFractionDigits: 0,
  style: "currency",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return CURRENCY.format(value ?? 0);
}

function rows(receipt) {
  const itemRows = receipt.payload.items.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.sku)}</small></td>
      <td class="number">${item.quantity}</td>
      <td class="number">${money(item.unitPriceCents)}</td>
      <td class="number">${money(item.lineTotalCents)}</td>
    </tr>`);
  const additionRows = (receipt.payload.additions ?? []).map((addition) => `
    <tr>
      <td><strong>${escapeHtml(addition.name)}</strong><br><small>Adicional óptico</small></td>
      <td class="number">${addition.quantity}</td>
      <td class="number">${money(addition.unitPriceCents)}</td>
      <td class="number">${money(addition.lineTotalCents)}</td>
    </tr>`);
  return [...itemRows, ...additionRows].join("");
}

export function renderReceiptHtml(receipt, { document = true } = {}) {
  const receiptTitle = receipt.type === "PAYMENT"
    ? "Comprobante de abono"
    : "Comprobante final de venta";
  const customerData = receipt.payload.customer ?? null;
  const customer = [
    customerData?.firstNames,
    customerData?.lastNames,
  ].filter(Boolean).join(" ");
  const patient = receipt.payload.patient
    ? [
      receipt.payload.patient.firstNames,
      receipt.payload.patient.lastNames,
    ].filter(Boolean).join(" ")
    : "No aplica";
  const discountRow = receipt.payload.discount ? `
    <div class="total-row discount"><span>Descuento autorizado</span><strong>−${money(receipt.payload.discount.amountCents)}</strong></div>
    <p class="discount-reason">${escapeHtml(receipt.payload.discount.reason)}</p>` : "";
  const cashRow = receipt.payload.payment?.paymentMethod === "CASH" ? `
        <div class="total-row"><span>Recibido en efectivo</span><strong>${money(receipt.payload.payment.cashReceivedCents)}</strong></div>
        <div class="total-row"><span>Vuelto</span><strong>${money(receipt.payload.payment.changeCents)}</strong></div>` : "";
  const body = `
    <main class="receipt">
      <header>
        <div><p class="eyebrow">Óptica Stylo</p><h1>${receiptTitle}</h1></div>
        <div class="receipt-number"><span>N.º</span><strong>${receipt.receiptNumber}</strong></div>
      </header>
      <section class="meta">
        <p><span>Venta</span><strong>#${receipt.payload.saleNumber}</strong></p>
        <p><span>Fecha</span><strong>${new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(receipt.issuedAt))}</strong></p>
        <p><span>Cliente</span><strong>${escapeHtml(customer || "Venta sin cliente registrado")}</strong></p>
        <p><span>RUT cliente</span><strong>${escapeHtml(customerData?.rut || "No informado")}</strong></p>
        <p><span>Paciente</span><strong>${escapeHtml(patient)}</strong></p>
      </section>
      <table>
        <thead><tr><th>Detalle</th><th>Cant.</th><th>Unitario</th><th>Total</th></tr></thead>
        <tbody>${rows(receipt)}</tbody>
      </table>
      <section class="totals">
        <div class="total-row"><span>Subtotal</span><strong>${money(receipt.payload.subtotalCents)}</strong></div>
        ${discountRow}
        <div class="total-row grand"><span>Total</span><strong>${money(receipt.payload.totalCents)}</strong></div>
        <div class="total-row"><span>Pagado / abonado</span><strong>${money(receipt.payload.paidCents)}</strong></div>
        ${cashRow}
        <div class="total-row"><span>Saldo</span><strong>${money(receipt.payload.balanceCents)}</strong></div>
      </section>
      <footer>Gracias por preferir Óptica Stylo. Este comprobante inmutable conserva el estado de la operación al momento de emitirse.</footer>
    </main>`;

  if (!document) return body;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comprobante ${receipt.receiptNumber}</title><style>
    :root{font-family:Inter,Arial,sans-serif;color:#182522;background:#f4f1eb}*{box-sizing:border-box}body{margin:0;padding:32px}.receipt{max-width:780px;margin:auto;background:#fff;border:1px solid #dce3df;border-radius:18px;padding:36px;box-shadow:0 18px 50px #233c3320}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #116b5a;padding-bottom:22px}.eyebrow{color:#116b5a;font-weight:800;text-transform:uppercase;letter-spacing:.12em;margin:0 0 6px}h1{font-size:28px;margin:0}.receipt-number{text-align:right}.receipt-number span{display:block;color:#66736f}.receipt-number strong{font-size:28px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px;padding:22px 0}.meta p{margin:0;display:flex;justify-content:space-between;gap:12px}.meta span{color:#66736f}table{width:100%;border-collapse:collapse}th,td{padding:12px 8px;border-bottom:1px solid #e5e9e7;text-align:left}.number{text-align:right}.totals{margin:22px 0 0 auto;max-width:360px}.total-row{display:flex;justify-content:space-between;gap:20px;padding:7px 0}.grand{font-size:20px;border-top:2px solid #182522;margin-top:8px;padding-top:12px}.discount{color:#9b3b27}.discount-reason{font-size:12px;color:#66736f;text-align:right;margin:0 0 6px}footer{text-align:center;color:#66736f;border-top:1px solid #e5e9e7;margin-top:30px;padding-top:18px}@media(max-width:600px){body{padding:0}.receipt{border:0;border-radius:0;padding:20px}.meta{grid-template-columns:1fr}th:nth-child(3),td:nth-child(3){display:none}}@media print{body{background:#fff;padding:0}.receipt{box-shadow:none;border:0;max-width:none;padding:0}@page{margin:14mm}}
  </style></head><body>${body}</body></html>`;
}
