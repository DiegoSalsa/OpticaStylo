import assert from "node:assert/strict";
import test from "node:test";

import {
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
  assert.equal(mapEmail(row("FAILED"), { includeOtpCode: true }).payload.code, "123456");
  assert.equal(mapEmail(row("FAILED")).payload.code, undefined);
});

test("los logs de transición no necesitan el código OTP", () => {
  const serialized = JSON.stringify({ code: null, emailId: "otp-outbox-1", event: "transactional_email_transition", status: "SENT" });
  assert.equal(serialized.includes("123456"), false);
});
