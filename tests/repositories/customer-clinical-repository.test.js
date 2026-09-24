import assert from "node:assert/strict";
import { hashCustomerPatientOtp } from "../../src/utils/customer-patient-otp.js";
import test from "node:test";

import {
  createCustomerPatientOtpChallenge,
  findCustomerClinicalOverview,
  mapCustomerClinicalAppointment,
  mapCustomerClinicalPrescription,
  verifyCustomerPatientOtpChallenge,
} from "../../src/repositories/customer-clinical-repository.js";

const accountA = "00000000-0000-4000-8000-000000000001";
const accountB = "00000000-0000-4000-8000-000000000002";
const customerA = "10000000-0000-4000-8000-000000000001";
const customerB = "10000000-0000-4000-8000-000000000002";
const patientA = "20000000-0000-4000-8000-000000000001";
const patientB = "20000000-0000-4000-8000-000000000002";

// Crear un cliente Prisma mínimo para probar las transacciones reales del repository sin una base externa.
function fakeClinicalClient() {
  const state = {
    accounts: new Map([
      [accountA, { id: accountA, customerId: customerA, email: "ana@example.com", customer: { id: customerA, rut: "11111111-1", email: "ana@example.com", first_names: "Ana", last_names: "A", patient_id: null } }],
      [accountB, { id: accountB, customerId: customerB, email: "bea@example.com", customer: { id: customerB, rut: "22222222-2", email: "bea@example.com", first_names: "Bea", last_names: "B", patient_id: patientB } }],
    ]),
    patients: new Map([
      [patientA, { id: patientA, rut: "11111111-1", email: "ana@example.com", first_names: "Ana", last_names: "A", birth_date: new Date("1990-05-20T00:00:00.000Z"), customerId: null }],
      [patientB, { id: patientB, rut: "22222222-2", email: "bea@example.com", first_names: "Bea", last_names: "B", birth_date: new Date("1990-05-20T00:00:00.000Z"), customerId: customerB }],
    ]),
    challenges: [], outbox: [],
    appointments: [
      { patient_id: patientA, start_at: new Date("2026-10-01T15:00:00.000Z"), end_at: new Date("2026-10-01T16:00:00.000Z"), status: "CONFIRMED", professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Profesional", last_name: "A" } } },
      { patient_id: patientB, start_at: new Date("2026-10-02T15:00:00.000Z"), end_at: new Date("2026-10-02T16:00:00.000Z"), status: "CONFIRMED", professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Profesional", last_name: "B" } } },
    ],
    prescriptions: [
      { patient_id: patientA, encounterStatus: "FINALIZED", status: "ACTIVE", issued_at: new Date("2026-09-01T12:00:00.000Z"), right_sphere: "-1.00", right_cylinder: "-0.50", right_axis: 90, right_addition: null, left_sphere: "-1.25", left_cylinder: "-0.50", left_axis: 90, left_addition: null, pupillary_distance: "62.00", fulfillment_notes: null, professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Profesional", last_name: "A" } }, other_optical_prescriptions: [] },
      { patient_id: patientB, encounterStatus: "FINALIZED", status: "ACTIVE", issued_at: new Date("2026-09-01T12:00:00.000Z"), right_sphere: "-2.00", right_cylinder: "-0.50", right_axis: 90, right_addition: null, left_sphere: "-2.25", left_cylinder: "-50", left_axis: 90, left_addition: null, pupillary_distance: "64.00", fulfillment_notes: null, professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Profesional", last_name: "B" } }, other_optical_prescriptions: [] },
      { patient_id: patientA, encounterStatus: "DRAFT", status: "ACTIVE", issued_at: new Date("2026-09-02T12:00:00.000Z"), right_sphere: "-3.00", right_cylinder: "0", right_axis: null, right_addition: null, left_sphere: "-3.00", left_cylinder: "0", left_axis: null, left_addition: null, pupillary_distance: "62.00", fulfillment_notes: "borrador", professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Privado", last_name: "Borrador" } }, other_optical_prescriptions: [] },
    ],
  };
  const accountRow = (row, select) => select?.customer_id
    ? { customer_id: row.customerId, customers: { patient_id: row.customer.patient_id } }
    : { id: row.id, email: row.email, customers: { ...row.customer } };
  const client = {
    state,
    $transaction: async (callback) => callback(client),
    customer_accounts: { findUnique: async ({ where, select }) => { const row = state.accounts.get(where.id); return row ? accountRow(row, select) : null; } },
    patients: {
      findFirst: async ({ where }) => [...state.patients.values()].find((row) => row.rut === where.rut && row.email.toLowerCase() === where.email.equals.toLowerCase() && row.birth_date.getTime() === where.birth_date.getTime()) ? { ...[...state.patients.values()].find((row) => row.rut === where.rut && row.email.toLowerCase() === where.email.equals.toLowerCase() && row.birth_date.getTime() === where.birth_date.getTime()), customers: [...state.patients.values()].find((item) => item.rut === where.rut)?.customerId ? { id: [...state.patients.values()].find((item) => item.rut === where.rut).customerId } : null } : null,
      findUnique: async ({ where }) => { const row = state.patients.get(where.id); return row ? { ...row, customers: row.customerId ? { id: row.customerId } : null } : null; },
    },
    customers: {
      updateMany: async ({ where, data }) => { if (state.throwOnCustomerUpdate) { const error = new Error("unique"); error.code = "P2002"; throw error; } const row = [...state.accounts.values()].find((item) => item.customerId === where.id); if (!row || (where.patient_id === null && row.customer.patient_id !== null)) return { count: 0 }; row.customer.patient_id = data.patient_id; const patient = state.patients.get(data.patient_id); if (patient) patient.customerId = row.customerId; return { count: 1 }; },
      findUnique: async ({ where }) => { const row = [...state.accounts.values()].find((item) => item.customerId === where.id); return row ? { patient_id: row.customer.patient_id } : null; },
    },
    customer_patient_link_challenges: {
      updateMany: async ({ where, data }) => { let count = 0; for (const challenge of state.challenges) if ((!where.id || challenge.id === where.id) && (!where.account_id || challenge.account_id === where.account_id) && challenge.consumed_at === null && (!where.attempt_count || challenge.attempt_count < where.attempt_count.lt)) { if (data.attempt_count?.increment) challenge.attempt_count += data.attempt_count.increment; if (Object.hasOwn(data, "consumed_at")) challenge.consumed_at = data.consumed_at; count += 1; } return { count }; },
      create: async ({ data }) => { const row = { ...data, created_at: new Date("2026-09-24T12:00:00.000Z"), consumed_at: null, attempt_count: 0 }; state.challenges.push(row); return row; },
      findFirst: async ({ where }) => state.challenges.filter((row) => row.account_id === where.account_id && row.consumed_at === null).sort((a, b) => b.created_at - a.created_at)[0] ?? null,
    },
    transactional_email_outbox: { create: async ({ data }) => { const row = { id: data.deduplication_key, ...data }; state.outbox.push(row); return row; } },
    appointments: { findMany: async ({ where }) => state.appointments.filter((row) => row.patient_id === where.patient_id) },
    optical_prescriptions: { findMany: async ({ where }) => state.prescriptions.filter((row) => row.patient_id === where.clinical_encounters.patient_id && row.encounterStatus === where.clinical_encounters.status) },
  };
  return client;
}

test("proyecta reservas sin notas ni eventos internos", () => {
  const result = mapCustomerClinicalAppointment({
    end_at: new Date("2026-10-01T16:00:00.000Z"),
    id: "appointment-internal",
    internal_notes: "dato privado",
    appointment_events: [{ details: "historial privado" }],
    professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Ana", last_name: "Rojas" } },
    start_at: new Date("2026-10-01T15:00:00.000Z"),
    status: "CONFIRMED",
  });
  assert.deepEqual(result, {
    endAt: new Date("2026-10-01T16:00:00.000Z"),
    professional: { firstName: "Ana", lastName: "Rojas" },
    startAt: new Date("2026-10-01T15:00:00.000Z"),
    status: "CONFIRMED",
  });
  assert.equal(result.internalNotes, undefined);
  assert.equal(result.appointmentEvents, undefined);
});

test("proyecta recetas de atención finalizada sin ficha clínica y distingue reemplazos", () => {
  const result = mapCustomerClinicalPrescription({
    anamnesis: "dato privado",
    diagnosis: "dato privado",
    fulfillment_notes: "Preparar en cristal orgánico",
    issued_at: new Date("2026-09-01T12:00:00.000Z"),
    left_addition: "1.00", left_axis: 90, left_cylinder: "-0.50", left_sphere: "-1.25",
    other_optical_prescriptions: [{ status: "VOIDED" }],
    professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Luis", last_name: "Pérez" } },
    pupillary_distance: "62.00",
    right_addition: "1.00", right_axis: 90, right_cylinder: "-0.50", right_sphere: "-1.00",
    status: "VOIDED",
  });
  assert.equal(result.status, "REPLACED");
  assert.equal(result.fulfillmentNotes, "Preparar en cristal orgánico");
  assert.equal(result.anamnesis, undefined);
  assert.equal(result.diagnosis, undefined);
  assert.equal(result.professional.firstName, "Luis");
});

test("el repository crea un OTP con hash, receptor clínico y expiración", async () => {
  const client = fakeClinicalClient();
  const environment = { CUSTOMER_PATIENT_OTP_SECRET: "s".repeat(32) };
  const result = await createCustomerPatientOtpChallenge(accountA, { birthDate: "1990-05-20" }, {
    client, environment, createChallengeId: () => "30000000-0000-4000-8000-000000000001", generateCode: () => "123456", now: () => new Date("2026-09-24T12:00:00.000Z"),
  });
  assert.equal(result.maskedEmail, "a•a@example.com");
  assert.equal(result.outboxId, "customer-patient-otp:30000000-0000-4000-8000-000000000001");
  assert.equal(client.state.outbox[0].recipient_email, "ana@example.com");
  assert.notEqual(client.state.challenges[0].code_hash, "123456");
  assert.equal(client.state.challenges[0].expires_at.toISOString(), "2026-09-24T12:10:00.000Z");
});

test("el repository consume el OTP correcto una sola vez y vincula al paciente", async () => {
  const client = fakeClinicalClient();
  const environment = { CUSTOMER_PATIENT_OTP_SECRET: "s".repeat(32) };
  await createCustomerPatientOtpChallenge(accountA, { birthDate: "1990-05-20" }, { client, environment, createChallengeId: () => "30000000-0000-4000-8000-000000000002", generateCode: () => "654321", now: () => new Date("2026-09-24T12:00:00.000Z") });
  const result = await verifyCustomerPatientOtpChallenge(accountA, "654321", { client, environment, now: () => new Date("2026-09-24T12:05:00.000Z") });
  assert.equal(result.reason, null);
  assert.equal(client.state.accounts.get(accountA).customer.patient_id, patientA);
  assert.ok(client.state.challenges[0].consumed_at);
  const reused = await verifyCustomerPatientOtpChallenge(accountA, "654321", { client, environment, now: () => new Date("2026-09-24T12:06:00.000Z") });
  assert.equal(reused.reason, "OTP_INVALID");
});

test("el repository rechaza OTP incorrectos y bloquea el quinto intento", async () => {
  const client = fakeClinicalClient();
  const environment = { CUSTOMER_PATIENT_OTP_SECRET: "s".repeat(32) };
  await createCustomerPatientOtpChallenge(accountA, { birthDate: "1990-05-20" }, { client, environment, createChallengeId: () => "30000000-0000-4000-8000-000000000003", generateCode: () => "654321", now: () => new Date("2026-09-24T12:00:00.000Z") });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await verifyCustomerPatientOtpChallenge(accountA, "000000", { client, environment, now: () => new Date("2026-09-24T12:01:00.000Z") });
    assert.equal(result.reason, "OTP_INVALID");
  }
  assert.equal(client.state.challenges[0].attempt_count, 5);
});

test("el repository rechaza un OTP expirado sin vincular la cuenta", async () => {
  const client = fakeClinicalClient();
  const environment = { CUSTOMER_PATIENT_OTP_SECRET: "s".repeat(32) };
  await createCustomerPatientOtpChallenge(accountA, { birthDate: "1990-05-20" }, { client, environment, createChallengeId: () => "30000000-0000-4000-8000-000000000004", generateCode: () => "654321", now: () => new Date("2026-09-24T12:00:00.000Z") });
  const result = await verifyCustomerPatientOtpChallenge(accountA, "654321", { client, environment, now: () => new Date("2026-09-24T12:11:00.000Z") });
  assert.equal(result.reason, "OTP_INVALID");
  assert.equal(client.state.accounts.get(accountA).customer.patient_id, null);
});

test("el vínculo existente al mismo paciente es idempotente y otro paciente genera conflicto", async () => {
  const client = fakeClinicalClient();
  const environment = { CUSTOMER_PATIENT_OTP_SECRET: "s".repeat(32) };
  client.state.accounts.get(accountA).customer.patient_id = patientA;
  client.state.patients.get(patientA).customerId = customerA;
  const challengeId = "30000000-0000-4000-8000-000000000005";
  client.state.challenges.push({ account_id: accountA, code_hash: hashCustomerPatientOtp(challengeId, "654321", environment), created_at: new Date("2026-09-24T12:00:00.000Z"), expires_at: new Date("2026-09-24T12:10:00.000Z"), id: challengeId, patient_id: patientA, consumed_at: null, attempt_count: 0 });
  const same = await verifyCustomerPatientOtpChallenge(accountA, "654321", { client, environment, now: () => new Date("2026-09-24T12:05:00.000Z") });
  assert.equal(same.reason, null);

  const otherChallenge = "30000000-0000-4000-8000-000000000006";
  client.state.challenges.push({ account_id: accountA, code_hash: hashCustomerPatientOtp(otherChallenge, "123456", environment), created_at: new Date("2026-09-24T12:00:00.000Z"), expires_at: new Date("2026-09-24T12:10:00.000Z"), id: otherChallenge, patient_id: patientB, consumed_at: null, attempt_count: 0 });
  const conflict = await verifyCustomerPatientOtpChallenge(accountA, "123456", { client, environment, now: () => new Date("2026-09-24T12:05:00.000Z") });
  assert.equal(conflict.reason, "PATIENT_LINKED");
});

test("un paciente vinculado y una carrera UNIQUE se traducen a conflictos seguros", async () => {
  const client = fakeClinicalClient();
  const environment = { CUSTOMER_PATIENT_OTP_SECRET: "s".repeat(32) };
  const original = client.state.accounts.get(accountA).customer;
  client.state.accounts.get(accountA).email = "bea@example.com";
  original.rut = "22222222-2";
  original.email = "bea@example.com";
  const linked = await createCustomerPatientOtpChallenge(accountA, { birthDate: "1990-05-20" }, { client, environment, createChallengeId: () => "30000000-0000-4000-8000-000000000007", generateCode: () => "654321", now: () => new Date("2026-09-24T12:00:00.000Z") });
  assert.equal(linked.reason, "PATIENT_LINKED");

  client.state.accounts.get(accountA).email = "ana@example.com";
  original.rut = "11111111-1";
  original.email = "ana@example.com";
  await createCustomerPatientOtpChallenge(accountA, { birthDate: "1990-05-20" }, { client, environment, createChallengeId: () => "30000000-0000-4000-8000-000000000008", generateCode: () => "654321", now: () => new Date("2026-09-24T12:00:00.000Z") });
  client.state.throwOnCustomerUpdate = true;
  const result = await verifyCustomerPatientOtpChallenge(accountA, "654321", { client, environment, now: () => new Date("2026-09-24T12:05:00.000Z") });
  assert.equal(result.reason, "PATIENT_LINKED");
});

test("una cuenta solo obtiene reservas y recetas de su paciente vinculado", async () => {
  const client = fakeClinicalClient();
  const overviewA = await findCustomerClinicalOverview(accountA, new Date("2026-09-24T12:00:00.000Z"), { client });
  const overviewB = await findCustomerClinicalOverview(accountB, new Date("2026-09-24T12:00:00.000Z"), { client });
  assert.equal(overviewA.linked, false);
  client.state.accounts.get(accountA).customer.patient_id = patientA;
  const linkedA = await findCustomerClinicalOverview(accountA, new Date("2026-09-24T12:00:00.000Z"), { client });
  assert.equal(linkedA.upcomingAppointments.length, 1);
  assert.equal(linkedA.upcomingAppointments[0].professional.lastName, "A");
  assert.equal(linkedA.prescriptions.active.length, 1);
  assert.equal(linkedA.prescriptions.active[0].professional.lastName, "A");
  assert.equal(linkedA.prescriptions.history.length, 0);
  assert.equal(overviewB.patient.firstNames, "Bea");
  assert.equal(linkedA.upcomingAppointments.some((item) => item.professional.lastName === "B"), false);
  assert.equal(linkedA.prescriptions.active.some((item) => item.professional.lastName === "B"), false);
});
