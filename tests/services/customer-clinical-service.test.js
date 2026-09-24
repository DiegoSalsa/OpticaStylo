import assert from "node:assert/strict";
import test from "node:test";

import {
  getCustomerClinicalOverview,
  linkCustomerPatient,
} from "../../src/services/customer-clinical-service.js";

const account = { id: "00000000-0000-4000-8000-000000000001" };
const birthDate = "1990-05-20";

test("vincula una cuenta con identidad verificada", async () => {
  const result = await linkCustomerPatient(account, { birthDate }, {
    linkPatient: async (accountId, identity) => {
      assert.equal(accountId, account.id);
      assert.deepEqual(identity, { birthDate, email: null });
      return { patient: { firstNames: "Ana", lastNames: "Pérez", rutMasked: "••••678-5" }, reason: null };
    },
  });
  assert.deepEqual(result, { linked: true, patient: { firstNames: "Ana", lastNames: "Pérez", rutMasked: "••••678-5" } });
});

test("usa el mismo mensaje para fecha, correo e identidad inexistente", async () => {
  for (const reason of ["IDENTITY", "PATIENT_LINKED"]) {
    await assert.rejects(
      () => linkCustomerPatient(account, { birthDate, email: "incorrecto@example.com" }, {
        linkPatient: async () => ({ patient: null, reason }),
      }),
      (error) => ["CUSTOMER_PATIENT_LINK_FAILED", "CUSTOMER_PATIENT_LINK_CONFLICT"].includes(error.code)
        && error.message === "No fue posible verificar un registro de paciente con los datos proporcionados.",
    );
  }
});

test("traduce una cuenta ya vinculada a otro paciente sin cambiarla", async () => {
  await assert.rejects(
    () => linkCustomerPatient(account, { birthDate }, { linkPatient: async () => ({ reason: "ALREADY_LINKED" }) }),
    (error) => error.code === "CUSTOMER_PATIENT_ALREADY_LINKED" && error.status === 409,
  );
});

test("rechaza la vinculación sin sesión y entradas malformadas", async () => {
  await assert.rejects(() => linkCustomerPatient(null, { birthDate }), (error) => error.status === 401);
  await assert.rejects(() => linkCustomerPatient(account, { birthDate: "1990-02-30" }), /fecha de nacimiento no es válida/);
  await assert.rejects(() => linkCustomerPatient(account, { birthDate, patientId: "00000000-0000-4000-8000-000000000002" }), /cuerpo de la solicitud no es válido/);
});

test("deriva el resumen clínico desde la cuenta y no acepta patientId externo", async () => {
  let receivedAccountId = null;
  const overview = {
    linked: true,
    patient: { firstNames: "Ana", lastNames: "Pérez", rutMasked: "••••678-5" },
    upcomingAppointments: [{ startAt: "2026-10-01T15:00:00.000Z", status: "CONFIRMED" }],
    appointmentHistory: [],
    prescriptions: { active: [], history: [] },
  };
  const result = await getCustomerClinicalOverview(account, {
    findOverview: async (accountId) => { receivedAccountId = accountId; return overview; },
  });
  assert.equal(receivedAccountId, account.id);
  assert.equal(result.patient.rutMasked, "••••678-5");
  assert.equal(result.patientId, undefined);
});
