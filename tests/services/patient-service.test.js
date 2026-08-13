import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  createPatient,
  getPatient,
  getPatientList,
  updatePatient,
} from "../../src/services/patient-service.js";

const actor = {
  permissions: [
    PERMISSIONS.PATIENTS_MANAGE_BASIC,
    PERMISSIONS.PATIENTS_READ_BASIC,
  ],
  userId: "00000000-0000-4000-8000-000000000001",
};
const patientId = "00000000-0000-4000-8000-000000000002";
const currentDate = new Date("2026-08-13T12:00:00.000Z");
const input = {
  address: "Avenida Principal 123",
  birthDate: "1990-05-20",
  email: "paciente@example.com",
  firstNames: "María José",
  lastNames: "Pérez Soto",
  phone: "+56912345678",
  rut: "12.345.678-5",
};
const storedPatient = {
  ...input,
  guardian: null,
  id: patientId,
  rut: "12345678-5",
};

test("crea un paciente con los datos normalizados", async () => {
  const result = await createPatient(input, actor, {
    createPatientWithGuardian: async (patientData, actorUserId) => {
      assert.equal(patientData.rut, "12345678-5");
      assert.equal(actorUserId, actor.userId);
      return { ...patientData, id: patientId };
    },
    currentDate,
  });

  assert.equal(result.id, patientId);
});

test("rechaza la creación sin permiso de administración", async () => {
  await assert.rejects(
    () => createPatient(input, { ...actor, permissions: [] }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS" && error.status === 403,
  );
});

test("convierte un RUT duplicado en conflicto de dominio", async () => {
  await assert.rejects(
    () =>
      createPatient(input, actor, {
        createPatientWithGuardian: async () => {
          const error = new Error("duplicate key");
          error.code = "23505";
          throw error;
        },
        currentDate,
      }),
    (error) =>
      error.code === "PATIENT_RUT_ALREADY_EXISTS" && error.status === 409,
  );
});

test("consulta un paciente con permiso de lectura", async () => {
  const result = await getPatient(patientId, actor, {
    findPatientById: async (receivedId) => {
      assert.equal(receivedId, patientId);
      return storedPatient;
    },
  });

  assert.equal(result, storedPatient);
});

test("informa cuando el paciente no existe", async () => {
  await assert.rejects(
    () =>
      getPatient(patientId, actor, {
        findPatientById: async () => null,
      }),
    (error) => error.code === "PATIENT_NOT_FOUND" && error.status === 404,
  );
});

test("lista pacientes con paginación validada", async () => {
  const expectedList = {
    items: [storedPatient],
    page: 2,
    pageSize: 10,
    total: 11,
    totalPages: 2,
  };
  const result = await getPatientList(
    new URLSearchParams("page=2&pageSize=10&search=Pérez"),
    actor,
    {
      listPatients: async (query) => {
        assert.deepEqual(query, {
          page: 2,
          pageSize: 10,
          search: "Pérez",
        });
        return expectedList;
      },
    },
  );

  assert.equal(result, expectedList);
});

test("actualiza un paciente conservando los demás datos", async () => {
  const result = await updatePatient(
    patientId,
    { phone: "+56 9 9999 9999" },
    actor,
    {
      currentDate,
      findPatientById: async () => storedPatient,
      updatePatientWithGuardian: async (
        receivedId,
        patientData,
        actorUserId,
      ) => {
        assert.equal(receivedId, patientId);
        assert.equal(patientData.phone, "+56999999999");
        assert.equal(patientData.rut, storedPatient.rut);
        assert.equal(actorUserId, actor.userId);
        return { ...storedPatient, ...patientData };
      },
    },
  );

  assert.equal(result.phone, "+56999999999");
});
