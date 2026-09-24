import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmCustomerPatientLink,
  getCustomerClinicalOverview,
  requestCustomerPatientLinkCode,
} from "../../src/services/customer-clinical-service.js";

const account = { id: "00000000-0000-4000-8000-000000000001" };
const birthDate = "1990-05-20";

test("solicita un OTP y solo devuelve el correo enmascarado", async () => {
  const result = await requestCustomerPatientLinkCode(account, { birthDate }, {
    createChallenge: async (accountId, identity) => {
      assert.equal(accountId, account.id);
      assert.deepEqual(identity, { birthDate });
      return { expiresAt: new Date("2026-09-24T12:10:00.000Z"), maskedEmail: "a••a@ejemplo.cl", reason: null };
    },
  });
  assert.deepEqual(result, { challengeSent: true, expiresAt: new Date("2026-09-24T12:10:00.000Z"), maskedEmail: "a••a@ejemplo.cl" });
});

test("confirma un OTP correcto y vincula la cuenta", async () => {
  const result = await confirmCustomerPatientLink(account, { code: "123456" }, {
    verifyChallenge: async (accountId, code) => {
      assert.equal(accountId, account.id); assert.equal(code, "123456");
      return { patient: { firstNames: "Ana", lastNames: "Pérez", rutMasked: "••••678-5" }, reason: null };
    },
  });
  assert.deepEqual(result, { linked: true, patient: { firstNames: "Ana", lastNames: "Pérez", rutMasked: "••••678-5" } });
});

test("traduce OTP incorrecto, expirado o agotado al mismo error", async () => {
  for (const reason of ["OTP_INVALID", "OTP_EXPIRED", "OTP_ATTEMPTS"]) {
    await assert.rejects(
      () => confirmCustomerPatientLink(account, { code: "123456" }, { verifyChallenge: async () => ({ reason }) }),
      (error) => error.code === "CUSTOMER_PATIENT_OTP_INVALID" && error.message === "No fue posible verificar el código de vinculación.",
    );
  }
});

test("mantiene la idempotencia y separa conflictos reales", async () => {
  const idempotent = await confirmCustomerPatientLink(account, { code: "123456" }, {
    verifyChallenge: async () => ({ patient: { firstNames: "Ana" }, reason: null }),
  });
  assert.equal(idempotent.linked, true);
  await assert.rejects(
    () => confirmCustomerPatientLink(account, { code: "123456" }, { verifyChallenge: async () => ({ reason: "ALREADY_LINKED" }) }),
    (error) => error.code === "CUSTOMER_PATIENT_ALREADY_LINKED",
  );
  await assert.rejects(
    () => confirmCustomerPatientLink(account, { code: "123456" }, { verifyChallenge: async () => ({ reason: "PATIENT_LINKED" }) }),
    (error) => error.code === "CUSTOMER_PATIENT_LINK_CONFLICT" && error.message.includes("No fue posible verificar"),
  );
});

test("una cuenta ya vinculada al mismo paciente responde de forma idempotente", async () => {
  const result = await requestCustomerPatientLinkCode(account, { birthDate }, {
    createChallenge: async () => ({
      patient: { firstNames: "Ana", lastNames: "Pérez", rutMasked: "••••678-5" },
      reason: "ALREADY_LINKED",
      samePatient: true,
    }),
  });
  assert.deepEqual(result, {
    challengeSent: false,
    linked: true,
    patient: { firstNames: "Ana", lastNames: "Pérez", rutMasked: "••••678-5" },
  });
});

test("rechaza request sin sesión e inputs malformados", async () => {
  await assert.rejects(() => requestCustomerPatientLinkCode(null, { birthDate }), (error) => error.status === 401);
  await assert.rejects(() => requestCustomerPatientLinkCode(account, { birthDate: "1990-02-30" }), /fecha de nacimiento no es válida/);
  await assert.rejects(() => confirmCustomerPatientLink(account, { code: "123456", patientId: "otro" }), /cuerpo de la solicitud no es válido/);
});

test("deriva el resumen desde la cuenta y no acepta patientId externo", async () => {
  let receivedAccountId = null;
  const overview = { linked: false, patient: null, upcomingAppointments: [], appointmentHistory: [], prescriptions: { active: [], history: [] } };
  const result = await getCustomerClinicalOverview(account, {
    findOverview: async (accountId) => { receivedAccountId = accountId; return overview; },
  });
  assert.equal(receivedAccountId, account.id);
  assert.equal(result.patientId, undefined);
});
