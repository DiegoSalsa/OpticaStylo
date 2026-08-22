const BRAND_NAME = "Stylo Vivo";
const TEMPLATE_VERSION = "2026-08-22.v1";

export const TRANSACTIONAL_EMAIL_TEMPLATE_CODES = Object.freeze([
  "ACCOUNT_CREATED",
  "APPOINTMENT_CONFIRMED",
  "APPOINTMENT_REMINDER",
  "ORDER_CONFIRMED",
  "PAYMENT_CONFIRMED",
  "POS_PAYMENT_RECEIPT",
  "POS_FINAL_RECEIPT",
]);

export function escapeEmailHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clp(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  return new Intl.NumberFormat("es-CL", {
    currency: "CLP",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function localDate(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function saleReference(payload) {
  const value = Number(payload.saleNumber);
  return Number.isSafeInteger(value) && value > 0 ? `N.º ${value}` : null;
}

function receiptReference(payload) {
  const value = Number(payload.receiptNumber);
  return Number.isSafeInteger(value) && value > 0 ? `N.º ${value}` : null;
}

function contentFor(email, timeZone) {
  const payload = email.payload ?? {};
  switch (email.templateCode) {
    case "ACCOUNT_CREATED":
      return {
        facts: [],
        intro: `${typeof payload.firstNames === "string" && payload.firstNames.trim()
          ? `Hola ${payload.firstNames.trim()}. `
          : ""}Tu cuenta fue creada correctamente. Ya puedes ingresar con el correo que registraste.`,
        title: "Cuenta creada",
      };
    case "APPOINTMENT_CONFIRMED":
      return {
        facts: [["Fecha y hora", localDate(payload.startAt, timeZone)]],
        intro: "Tu reserva quedó confirmada. Si necesitas cambiarla, comunícate con el equipo de la óptica.",
        title: "Reserva confirmada",
      };
    case "APPOINTMENT_REMINDER":
      return {
        facts: [["Fecha y hora", localDate(payload.startAt, timeZone)]],
        intro: "Te recordamos que tienes una reserva próxima.",
        title: "Recordatorio de reserva",
      };
    case "ORDER_CONFIRMED":
      return {
        facts: [["Pedido", saleReference(payload)], ["Total", clp(payload.totalCents)]],
        intro: "Recibimos tu pedido y quedó registrado para continuar su proceso.",
        title: "Pedido confirmado",
      };
    case "PAYMENT_CONFIRMED":
      return {
        facts: [["Pedido", saleReference(payload)], ["Monto confirmado", clp(payload.amountCents)]],
        intro: "El pago fue conciliado y registrado correctamente.",
        title: "Pago confirmado",
      };
    case "POS_PAYMENT_RECEIPT":
      return {
        facts: [
          ["Comprobante", receiptReference(payload)],
          ["Venta", saleReference(payload)],
          ["Abonado acumulado", clp(payload.paidCents)],
          ["Saldo", clp(payload.balanceCents)],
        ],
        intro: "Registramos un abono para tu compra. Este comprobante corresponde únicamente a ese estado de la venta.",
        title: "Comprobante de abono",
      };
    case "POS_FINAL_RECEIPT":
      return {
        facts: [
          ["Comprobante", receiptReference(payload)],
          ["Venta", saleReference(payload)],
          ["Total", clp(payload.totalCents)],
          ["Saldo", clp(payload.balanceCents)],
        ],
        intro: "La venta quedó pagada y este es su comprobante final.",
        title: "Comprobante final de venta",
      };
    default:
      throw new Error(`Plantilla transaccional desconocida: ${email.templateCode}.`);
  }
}

function visibleFacts(facts) {
  return facts.filter(([, value]) => value != null && value !== "");
}

export function renderTransactionalEmail(email, { mode, timeZone = "America/Santiago" }) {
  const content = contentFor(email, timeZone);
  const facts = visibleFacts(content.facts);
  const isTest = mode === "test";
  const prefix = isTest ? "[PRUEBA] " : "";
  const subject = `${prefix}${BRAND_NAME} · ${content.title}`;
  const testHtml = isTest
    ? '<div style="background:#fff3cd;color:#5f4600;padding:12px 20px;text-align:center;font-weight:700">MENSAJE DE PRUEBA · No fue enviado al destinatario original</div>'
    : "";
  const factHtml = facts.length > 0
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:24px 0">${facts.map(([label, value]) => `<tr><td style="padding:12px 0;border-top:1px solid #dce7e3;color:#55706a">${escapeEmailHtml(label)}</td><td style="padding:12px 0;border-top:1px solid #dce7e3;text-align:right;font-weight:700">${escapeEmailHtml(value)}</td></tr>`).join("")}</table>`
    : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(subject)}</title></head><body style="margin:0;background:#f4f1eb;font-family:Arial,sans-serif;color:#17352f;line-height:1.6">${testHtml}<main style="max-width:600px;margin:0 auto;padding:24px"><section style="background:#ffffff;border:1px solid #dce7e3;border-radius:18px;padding:32px"><p style="margin:0 0 8px;color:#08705d;font-size:14px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">${BRAND_NAME}</p><h1 style="margin:0 0 20px;font-size:28px;line-height:1.2">${escapeEmailHtml(content.title)}</h1><p style="margin:0">${escapeEmailHtml(content.intro)}</p>${factHtml}<p style="margin:24px 0 0;color:#55706a;font-size:13px">Este correo contiene solo la información mínima de esta operación.</p></section><p style="text-align:center;color:#6f7d79;font-size:12px">Plantilla ${TEMPLATE_VERSION}</p></main></body></html>`;
  const textFacts = facts.map(([label, value]) => `${label}: ${value}`).join("\n");
  const text = [
    isTest ? "MENSAJE DE PRUEBA. No fue enviado al destinatario original." : null,
    BRAND_NAME,
    content.title,
    content.intro,
    textFacts || null,
    `Plantilla ${TEMPLATE_VERSION}`,
  ].filter(Boolean).join("\n\n");
  return { html, subject, text, version: TEMPLATE_VERSION };
}
