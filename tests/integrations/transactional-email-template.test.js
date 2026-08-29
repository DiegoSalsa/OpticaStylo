import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSACTIONAL_EMAIL_TEMPLATE_CODES,
  renderTransactionalEmail,
} from "../../src/integrations/email/transactional-email-template.js";

const payloadByCode = {
  ACCOUNT_CREATED: { firstNames: "<script>alert('x')</script>" },
  APPOINTMENT_CONFIRMED: { startAt: "2026-08-24T13:00:00.000Z" },
  APPOINTMENT_REMINDER: { startAt: "2026-08-24T13:00:00.000Z" },
  ORDER_CONFIRMED: { saleNumber: 21, totalCents: 45000 },
  PAYMENT_CONFIRMED: { amountCents: 20000, saleNumber: 21 },
  PASSWORD_RECOVERY: { scope: "INTERNAL_USER" },
  POS_PAYMENT_RECEIPT: { balanceCents: 25000, paidCents: 20000, receiptNumber: 8, saleNumber: 21 },
  POS_FINAL_RECEIPT: { balanceCents: 0, receiptNumber: 9, saleNumber: 21, totalCents: 45000 },
};

for (const templateCode of TRANSACTIONAL_EMAIL_TEMPLATE_CODES) {
  test(`${templateCode} genera HTML responsivo, texto y versión`, () => {
    const rendered = renderTransactionalEmail(
      {
        ...(templateCode === "PASSWORD_RECOVERY"
          ? { passwordResetRequestId: "00000000-0000-4000-8000-000000000021" }
          : {}),
        payload: payloadByCode[templateCode],
        templateCode,
      },
      {
        ...(templateCode === "PASSWORD_RECOVERY"
          ? { createPasswordRecoveryUrl: () => "accion-de-prueba" }
          : {}),
        mode: "live",
        timeZone: "America/Santiago",
      },
    );
    assert.match(rendered.html, /<meta name="viewport"/);
    assert.match(rendered.html, /Stylo Vivo/);
    assert.ok(rendered.text.length > 20);
    assert.match(rendered.subject, /^Stylo Vivo · /);
    assert.match(rendered.version, /\.v2$/);
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

test("la plantilla de recuperación recibe referencias y no un token persistido", () => {
  let request;
  renderTransactionalEmail(
    {
      passwordResetRequestId: "00000000-0000-4000-8000-000000000023",
      payload: payloadByCode.PASSWORD_RECOVERY,
      templateCode: "PASSWORD_RECOVERY",
    },
    {
      createPasswordRecoveryUrl: (input) => {
        request = input;
        return "accion-de-prueba";
      },
      mode: "live",
    },
  );
  assert.deepEqual(request, {
    requestId: "00000000-0000-4000-8000-000000000023",
    scope: "INTERNAL_USER",
  });
  assert.equal(Object.hasOwn(request, "token"), false);
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
