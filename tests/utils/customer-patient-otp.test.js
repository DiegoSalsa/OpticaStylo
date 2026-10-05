import assert from "node:assert/strict";
import test from "node:test";

import {
  hashCustomerPatientOtp,
  verifyCustomerPatientOtp,
} from "../../src/utils/customer-patient-otp.js";

const challengeId = "30000000-0000-4000-8000-000000000001";

test("exige CUSTOMER_PATIENT_OTP_SECRET independiente y suficientemente largo", () => {
  assert.throws(
    () => hashCustomerPatientOtp(challengeId, "123456", { CRON_SECRET: "c".repeat(64) }),
    /CUSTOMER_PATIENT_OTP_SECRET/,
  );
  assert.throws(
    () => hashCustomerPatientOtp(challengeId, "123456", { CUSTOMER_PATIENT_OTP_SECRET: "c".repeat(31) }),
    /al menos 32 caracteres/,
  );
});

test("HMAC sigue ligado al challengeId y verifica con timingSafeEqual", () => {
  const environment = { CUSTOMER_PATIENT_OTP_SECRET: "c".repeat(32) };
  const hash = hashCustomerPatientOtp(challengeId, "123456", environment);
  assert.equal(verifyCustomerPatientOtp(challengeId, "123456", hash, environment), true);
  assert.equal(verifyCustomerPatientOtp(`${challengeId.slice(0, -1)}2`, "123456", hash, environment), false);
});
