import assert from "node:assert/strict";
import test from "node:test";

import { validateCustomerPatientLinkInput } from "../../src/validations/customer-clinical-validation.js";

test("normaliza el correo opcional y exige fecha de nacimiento", () => {
  assert.deepEqual(
    validateCustomerPatientLinkInput({ birthDate: "1990-05-20", email: " Cliente@Example.com " }),
    { birthDate: "1990-05-20", email: "cliente@example.com" },
  );
});

test("rechaza patientId y fechas inválidas", () => {
  assert.throws(() => validateCustomerPatientLinkInput({ birthDate: "1990-05-20", patientId: "otro" }), /cuerpo de la solicitud no es válido/);
  assert.throws(() => validateCustomerPatientLinkInput({ birthDate: "2027-01-01" }, new Date("2026-01-01T00:00:00.000Z")), /no puede ser futura/);
});
