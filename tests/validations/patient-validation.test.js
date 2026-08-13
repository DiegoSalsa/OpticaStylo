import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCreatePatientInput,
  validatePatientListQuery,
  validateUpdatePatientInput,
} from "../../src/validations/patient-validation.js";

const currentDate = new Date("2026-08-13T12:00:00.000Z");
const adultPatient = {
  address: "Avenida Principal 123",
  birthDate: "1990-05-20",
  email: "Paciente@Example.com ",
  firstNames: "  María   José ",
  lastNames: "  Pérez   Soto ",
  phone: "+56 9 1234 5678",
  rut: "12.345.678-5",
};
const guardian = {
  email: "responsable@example.com",
  firstNames: "Juana",
  lastNames: "Soto Díaz",
  phone: "+56 9 8765 4321",
  relationship: "Madre",
  rut: "1.000.005-K",
};

test("normaliza los datos básicos de un paciente adulto", () => {
  assert.deepEqual(validateCreatePatientInput(adultPatient, currentDate), {
    address: "Avenida Principal 123",
    birthDate: "1990-05-20",
    email: "paciente@example.com",
    firstNames: "María José",
    guardian: null,
    lastNames: "Pérez Soto",
    phone: "+56912345678",
    rut: "12345678-5",
  });
});

test("exige un responsable para un paciente menor de edad", () => {
  assert.throws(
    () =>
      validateCreatePatientInput(
        { ...adultPatient, birthDate: "2012-01-10" },
        currentDate,
      ),
    /responsable para el paciente menor de edad/,
  );
});

test("acepta un paciente menor con su responsable", () => {
  const result = validateCreatePatientInput(
    { ...adultPatient, birthDate: "2012-01-10", guardian },
    currentDate,
  );

  assert.equal(result.guardian.rut, "1000005-K");
  assert.equal(result.guardian.relationship, "Madre");
});

test("rechaza fechas inexistentes o futuras", () => {
  assert.throws(
    () =>
      validateCreatePatientInput(
        { ...adultPatient, birthDate: "2026-02-30" },
        currentDate,
      ),
    /fecha de nacimiento no es válida/,
  );
  assert.throws(
    () =>
      validateCreatePatientInput(
        { ...adultPatient, birthDate: "2027-01-01" },
        currentDate,
      ),
    /no puede ser futura/,
  );
});

test("completa una actualización con los datos existentes", () => {
  const currentPatient = validateCreatePatientInput(adultPatient, currentDate);
  const result = validateUpdatePatientInput(
    { phone: "+56 9 9999 9999" },
    currentPatient,
    currentDate,
  );

  assert.equal(result.phone, "+56999999999");
  assert.equal(result.rut, currentPatient.rut);
});

test("rechaza una actualización sin campos admitidos", () => {
  assert.throws(
    () => validateUpdatePatientInput({ desconocido: true }, adultPatient),
    /al menos un dato para actualizar/,
  );
});

test("valida y normaliza la paginación", () => {
  const query = validatePatientListQuery(
    new URLSearchParams("page=2&pageSize=25&search=%20Pérez%20"),
  );

  assert.deepEqual(query, { page: 2, pageSize: 25, search: "Pérez" });
});

test("rechaza tamaños de página excesivos", () => {
  assert.throws(
    () => validatePatientListQuery(new URLSearchParams("pageSize=101")),
    /entre 1 y 100/,
  );
});
