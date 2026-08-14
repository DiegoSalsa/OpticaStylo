import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  addEncounterAddendum,
  createEncounter,
  finalizeEncounter,
  getEncounter,
  getMedicalRecord,
  getPatientClinicalHistory,
  updateMedicalRecord,
} from "../../src/services/clinical-service.js";

const professionalId = "00000000-0000-4000-8000-000000000001";
const otherProfessionalId = "00000000-0000-4000-8000-000000000002";
const patientId = "00000000-0000-4000-8000-000000000003";
const appointmentId = "00000000-0000-4000-8000-000000000004";
const encounterId = "00000000-0000-4000-8000-000000000005";
const professional = {
  permissions: [
    PERMISSIONS.MEDICAL_RECORDS_READ_ASSIGNED,
    PERMISSIONS.MEDICAL_RECORDS_WRITE_ASSIGNED,
  ],
  userId: professionalId,
};

function buildEncounter(overrides = {}) {
  return {
    id: encounterId,
    patient: { id: patientId },
    professional: { id: professionalId },
    status: "DRAFT",
    ...overrides,
  };
}

test("entrega una ficha vacía cuando aún no fue creada", async () => {
  const result = await getMedicalRecord(patientId, professional, {
    findMedicalRecordByPatientId: async () => null,
    findPatientById: async () => ({ id: patientId }),
    hasClinicalAssignment: async () => true,
  });

  assert.deepEqual(result, { patientId, record: null });
});

test("impide leer fichas de pacientes no asignados", async () => {
  await assert.rejects(
    () =>
      getMedicalRecord(patientId, professional, {
        findPatientById: async () => ({ id: patientId }),
        hasClinicalAssignment: async () => false,
      }),
    (error) => error.code === "CLINICAL_ACCESS_NOT_ASSIGNED",
  );
});

test("actualiza antecedentes solo con una atención presente o completada", async () => {
  const expected = { allergies: "Látex", patientId };
  const result = await updateMedicalRecord(
    patientId,
    { allergies: "Látex" },
    professional,
    {
      findPatientById: async () => ({ id: patientId }),
      hasClinicalAssignment: async (id, userId, statuses) => {
        assert.equal(id, patientId);
        assert.equal(userId, professionalId);
        assert.deepEqual(statuses, ["CHECKED_IN", "COMPLETED"]);
        return true;
      },
      upsertMedicalRecord: async (id, changes, userId) => {
        assert.equal(id, patientId);
        assert.equal(changes.allergies, "Látex");
        assert.equal(userId, professionalId);
        return expected;
      },
    },
  );

  assert.equal(result, expected);
});

test("crea la atención a partir de una reserva", async () => {
  const expected = buildEncounter();
  const result = await createEncounter(
    { appointmentId, reasonForVisit: "Control anual" },
    professional,
    {
      createClinicalEncounter: async (data, userId) => {
        assert.equal(data.appointmentId, appointmentId);
        assert.equal(userId, professionalId);
        return { encounter: expected, reason: null };
      },
    },
  );

  assert.equal(result, expected);
});

test("traduce el conflicto de una reserva sin llegada", async () => {
  await assert.rejects(
    () =>
      createEncounter(
        { appointmentId, reasonForVisit: "Control" },
        professional,
        {
          createClinicalEncounter: async () => ({
            encounter: null,
            reason: "INVALID_APPOINTMENT_STATUS",
          }),
        },
      ),
    (error) => error.code === "APPOINTMENT_NOT_CHECKED_IN",
  );
});

test("oculta el borrador de otro profesional", async () => {
  await assert.rejects(
    () =>
      getEncounter(encounterId, professional, {
        findClinicalEncounterById: async () =>
          buildEncounter({ professional: { id: otherProfessionalId } }),
      }),
    (error) => error.code === "CLINICAL_ENCOUNTER_NOT_FOUND",
  );
});

test("finaliza la atención usando la fecha controlada", async () => {
  const expected = buildEncounter({ status: "FINALIZED" });
  const currentDate = new Date("2026-08-14T15:00:00.000Z");
  const result = await finalizeEncounter(encounterId, professional, {
    currentDate,
    finalizeClinicalEncounter: async (id, userId, date) => {
      assert.equal(id, encounterId);
      assert.equal(userId, professionalId);
      assert.equal(date, currentDate);
      return { encounter: expected, reason: null };
    },
  });

  assert.equal(result.status, "FINALIZED");
});

test("exige examen y diagnóstico antes de finalizar", async () => {
  await assert.rejects(
    () =>
      finalizeEncounter(encounterId, professional, {
        finalizeClinicalEncounter: async () => ({
          encounter: null,
          reason: "INCOMPLETE",
        }),
      }),
    (error) => error.code === "INCOMPLETE_CLINICAL_ENCOUNTER",
  );
});

test("agrega una adenda permanente a una atención finalizada", async () => {
  const addendum = { id: "00000000-0000-4000-8000-000000000006" };
  const result = await addEncounterAddendum(
    encounterId,
    { content: "Se aclara lateralidad.", reason: "Aclaración" },
    professional,
    {
      addClinicalEncounterAddendum: async () => ({
        addendum,
        patientId,
        reason: null,
      }),
      findClinicalEncounterById: async () =>
        buildEncounter({ status: "FINALIZED" }),
      hasClinicalAssignment: async () => true,
    },
  );

  assert.equal(result, addendum);
});

test("lista únicamente el historial clínico autorizado", async () => {
  const result = await getPatientClinicalHistory(patientId, professional, {
    findPatientById: async () => ({ id: patientId }),
    hasClinicalAssignment: async () => true,
    listPatientClinicalHistory: async () => [
      buildEncounter({ status: "FINALIZED" }),
    ],
  });

  assert.equal(result.encounters.length, 1);
});

test("administración no puede consultar información clínica", async () => {
  await assert.rejects(
    () =>
      getMedicalRecord(patientId, {
        permissions: [PERMISSIONS.PATIENTS_READ_BASIC],
        userId: otherProfessionalId,
      }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS",
  );
});
