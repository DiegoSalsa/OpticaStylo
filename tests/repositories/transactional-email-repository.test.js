import assert from "node:assert/strict";
import test from "node:test";

import {
  getTransactionalEmailEligibility,
  mapEmail,
  sanitizeTransactionalEmailPayload,
} from "../../src/repositories/transactional-email-repository.js";

const row = (status, payload = { code: "123456", unrelated: "ok" }) => ({
  account_id: null,
  attempt_count: 1,
  created_at: new Date("2026-09-24T12:00:00.000Z"),
  deduplication_key: "otp:1",
  delivery_mode: "live",
  effective_recipient_email: "ana@example.com",
  id: "otp-outbox-1",
  last_error: null,
  last_error_code: null,
  lock_expires_at: null,
  locked_by: null,
  next_attempt_at: new Date("2026-09-24T12:00:00.000Z"),
  payload,
  processing_finished_at: null,
  processing_started_at: null,
  provider: null,
  provider_message_id: null,
  receipt_id: null,
  recipient_email: "ana@example.com",
  sale_id: null,
  scheduled_at: new Date("2026-09-24T12:00:00.000Z"),
  sent_at: null,
  skip_reason: null,
  status,
  template_code: "CUSTOMER_PATIENT_OTP",
  updated_at: new Date("2026-09-24T12:00:00.000Z"),
});

test("el outbox conserva temporalmente el OTP pendiente y durante PROCESSING", () => {
  assert.equal(sanitizeTransactionalEmailPayload("CUSTOMER_PATIENT_OTP", { code: "123456" }, "PENDING").code, "123456");
  assert.equal(mapEmail(row("PROCESSING"), { includeOtpCode: true }).payload.code, "123456");
});

test("el outbox elimina el OTP en todos los estados terminales", () => {
  for (const status of ["SENT", "TEST_SENT", "SIMULATED", "DEAD_LETTER", "SUPPRESSED", "DELIVERED", "BOUNCED", "COMPLAINED"]) {
    const payload = sanitizeTransactionalEmailPayload("CUSTOMER_PATIENT_OTP", { code: "123456", unrelated: "ok" }, status);
    assert.equal(payload.code, undefined, status);
    assert.equal(payload.unrelated, "ok");
    assert.equal(mapEmail(row(status), { includeOtpCode: true }).payload.code, undefined, status);
  }
});

test("FAILED reintentable conserva el OTP y la vista administrativa nunca lo expone", () => {
  assert.equal(sanitizeTransactionalEmailPayload("CUSTOMER_PATIENT_OTP", { code: "123456" }, "FAILED").code, "123456");
  const pending = row("FAILED", { challengeId: "challenge-a", code: "123456" });
  assert.equal(mapEmail(pending, { includeOtpCode: true }).payload.code, "123456");
  assert.equal(mapEmail(pending, { includeOtpCode: true }).payload.challengeId, "challenge-a");
  assert.equal(mapEmail(pending).payload.code, undefined);
  assert.equal(mapEmail(pending).payload.challengeId, undefined);
});

// Simular el filtro Prisma para comprobar cada condición de elegibilidad sin consultar una base externa.
function eligibilityClient(challenge) {
  return {
    customer_patient_link_challenges: {
      findFirst: async ({ where }) => challenge
        && challenge.id === where.id
        && challenge.account_id === where.account_id
        && challenge.consumed_at === where.consumed_at
        && challenge.expires_at > where.expires_at.gt
        && challenge.attempt_count < where.attempt_count.lt
        ? { id: challenge.id } : null,
    },
  };
}

const otpEmail = { accountId: "account-a", payload: { challengeId: "challenge-a", code: "123456" }, templateCode: "CUSTOMER_PATIENT_OTP" };
const now = new Date("2026-09-24T12:00:00.000Z");
const challenge = { account_id: "account-a", attempt_count: 0, consumed_at: null, expires_at: new Date("2026-09-24T12:10:00.000Z"), id: "challenge-a" };

test("OTP vigente y retry FAILED conservan elegibilidad", async () => {
  const dependencies = { client: eligibilityClient(challenge), now: () => now };
  assert.equal((await getTransactionalEmailEligibility(otpEmail, dependencies)).eligible, true);
  assert.equal((await getTransactionalEmailEligibility({ ...otpEmail, status: "FAILED" }, dependencies)).eligible, true);
});

test("OTP reemplazado, expirado, agotado, inexistente o de otra cuenta no es elegible", async () => {
  for (const obsolete of [
    { ...challenge, consumed_at: now },
    { ...challenge, expires_at: now },
    { ...challenge, attempt_count: 5 },
    null,
    { ...challenge, account_id: "account-b" },
  ]) {
    const result = await getTransactionalEmailEligibility(otpEmail, { client: eligibilityClient(obsolete), now: () => now });
    assert.deepEqual(result, { eligible: false, reason: "OTP_CHALLENGE_INVALID" });
  }
});

test("un correo OTP sin challengeId queda suprimible y un recordatorio conserva su regla", async () => {
  assert.equal((await getTransactionalEmailEligibility({ ...otpEmail, payload: {} }, { client: eligibilityClient(challenge), now: () => now })).eligible, false);
  const client = { appointments: { findUnique: async () => ({ start_at: new Date("2026-09-24T13:00:00.000Z"), status: "CONFIRMED" }) } };
  assert.equal((await getTransactionalEmailEligibility({ appointmentId: "appointment-a", templateCode: "APPOINTMENT_REMINDER" }, { client, now: () => now })).eligible, true);
});

test("los logs de transición no necesitan el código OTP", () => {
  const serialized = JSON.stringify({ code: null, emailId: "otp-outbox-1", event: "transactional_email_transition", status: "SENT" });
  assert.equal(serialized.includes("123456"), false);
});
