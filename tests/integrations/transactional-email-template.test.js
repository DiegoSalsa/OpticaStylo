import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSACTIONAL_EMAIL_TEMPLATE_CODES,
  renderTransactionalEmail,
} from "../../src/integrations/email/transactional-email-template.js";

const payloadByCode = {
  ACCOUNT_CREATED: { firstNames: "<script>alert('x')</script>" },
  CUSTOMER_PATIENT_OTP: { code: "123456" },
  APPOINTMENT_CONFIRMED: { startAt: "2026-08-24T13:00:00.000Z" },
  APPOINTMENT_REMINDER: { startAt: "2026-08-24T13:00:00.000Z" },
  APPOINTMENT_PROFESSIONAL: { action: "confirmed", startAt: "2026-08-24T13:00:00.000Z" },
  ORDER_CONFIRMED: { saleNumber: 21, totalCents: 45000 },
  PAYMENT_CONFIRMED: { amountCents: 20000, saleNumber: 21 },
  POS_PAYMENT_RECEIPT: { balanceCents: 25000, paidCents: 20000, receiptNumber: 8, saleNumber: 21 },
  POS_FINAL_RECEIPT: { balanceCents: 0, receiptNumber: 9, saleNumber: 21, totalCents: 45000 },
};

for (const templateCode of TRANSACTIONAL_EMAIL_TEMPLATE_CODES) {
  test(`${templateCode} genera HTML responsivo, texto y versión`, () => {
    const rendered = renderTransactionalEmail(
      { payload: payloadByCode[templateCode], templateCode },
      { mode: "live", timeZone: "America/Santiago" },
    );
    assert.match(rendered.html, /<meta name="viewport"/);
    assert.match(rendered.html, /Stylo Vivo/);
    assert.ok(rendered.text.length > 20);
    assert.match(rendered.subject, /^Stylo Vivo · /);
    assert.match(rendered.version, /\.v1$/);
  });
}

test("escapa todo contenido dinámico insertado en HTML", () => {
  const rendered = renderTransactionalEmail(
    { payload: payloadByCode.ACCOUNT_CREATED, templateCode: "ACCOUNT_CREATED" },
    { mode: "live" },
  );
  assert.equal(rendered.html.includes("<script>"), false);
  assert.match(rendered.html, /&lt;script&gt;/);
});

test("marca claramente una redirección de prueba", () => {
  const rendered = renderTransactionalEmail(
    { payload: payloadByCode.PAYMENT_CONFIRMED, templateCode: "PAYMENT_CONFIRMED" },
    { mode: "test" },
  );
  assert.match(rendered.subject, /^\[PRUEBA\]/);
  assert.match(rendered.html, /MENSAJE DE PRUEBA/);
  assert.match(rendered.text, /No fue enviado al destinatario original/);
});

test("formatea reservas en America Santiago sin depender de la zona del servidor", () => {
  const rendered = renderTransactionalEmail(
    { payload: payloadByCode.APPOINTMENT_REMINDER, templateCode: "APPOINTMENT_REMINDER" },
    { mode: "live", timeZone: "America/Santiago" },
  );
  assert.match(rendered.text, /9:00/);
});

test("ignora campos clínicos aunque aparezcan en el payload", () => {
  const rendered = renderTransactionalEmail(
    {
      payload: {
        ...payloadByCode.ORDER_CONFIRMED,
        diagnosis: "dato-prohibido",
        graduation: "dato-prohibido",
        prescriptionImage: "dato-prohibido",
      },
      templateCode: "ORDER_CONFIRMED",
    },
    { mode: "live" },
  );
  assert.equal(`${rendered.html}${rendered.text}`.includes("dato-prohibido"), false);
});

test("el aviso profesional distingue horarios en Chile y solo incluye datos de agenda permitidos", () => {
  const { html, text } = renderTransactionalEmail({
    templateCode: "APPOINTMENT_PROFESSIONAL",
    payload: {
      action: "rescheduled", appointmentId: "reserva-sintética", patientName: "<Paciente> Sintético",
      branchName: "Sucursal de prueba", previousStartAt: "2026-08-24T13:00:00.000Z",
      startAt: "2026-12-01T13:00:00.000Z", rut: "dato-privado", diagnosis: "dato-privado",
      internalNotes: "dato-privado", cancellationReason: "dato-privado",
    },
  }, { mode: "test" });
  assert.match(text, /Horario anterior: .*9:00/);
  assert.match(text, /Nuevo horario: .*10:00/);
  assert.match(text, /Sucursal de prueba/);
  assert.match(text, /Atención clínica/);
  assert.match(html, /&lt;Paciente&gt; Sintético/);
  assert.doesNotMatch(html + text, /dato-privado/);
});
