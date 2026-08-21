import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAddendumInput,
  validateCreateEncounterInput,
  validateCreatePrescriptionInput,
  validateMedicalRecordInput,
  validateUpdateEncounterInput,
} from "../../src/validations/clinical-validation.js";

const appointmentId = "00000000-0000-4000-8000-000000000001";

test("normaliza antecedentes clínicos conservando saltos de línea", () => {
  const result = validateMedicalRecordInput({
    allergies: "  Penicilina\r\nLátex  ",
    ocularHistory: null,
  });

  assert.equal(result.allergies, "Penicilina\nLátex");
  assert.equal(result.ocularHistory, null);
});

test("exige al menos un antecedente para actualizar la ficha", () => {
  assert.throws(
    () => validateMedicalRecordInput({ ignored: "value" }),
    (error) => error.code === "INVALID_CLINICAL_DATA",
  );
});

test("valida la creación de una atención ligada a una reserva", () => {
  const result = validateCreateEncounterInput({
    appointmentId,
    reasonForVisit: "Control anual",
  });

  assert.equal(result.appointmentId, appointmentId);
  assert.equal(result.reasonForVisit, "Control anual");
  assert.equal(result.diagnosis, null);
});

test("impide vaciar el motivo de consulta al editar", () => {
  assert.throws(
    () => validateUpdateEncounterInput({ reasonForVisit: "  " }),
    (error) => error.code === "INVALID_CLINICAL_DATA",
  );
});

test("valida una receta óptica bilateral", () => {
  const result = validateCreatePrescriptionInput({
    leftEye: { axis: 90, cylinder: -0.5, sphere: 1.25 },
    pupillaryDistance: 62.5,
    rightEye: { cylinder: 0, sphere: 1 },
  });

  assert.deepEqual(result.rightEye, {
    addition: null,
    axis: null,
    cylinder: 0,
    sphere: 1,
  });
  assert.equal(result.leftEye.axis, 90);
});

test("exige eje cuando el cilindro no es cero", () => {
  assert.throws(
    () =>
      validateCreatePrescriptionInput({
        leftEye: { cylinder: -0.5, sphere: 1 },
        rightEye: { cylinder: 0, sphere: 1 },
      }),
    (error) => error.code === "INVALID_CLINICAL_DATA",
  );
});

test("rechaza ejes fuera del rango óptico", () => {
  assert.throws(
    () =>
      validateCreatePrescriptionInput({
        leftEye: { axis: 181, cylinder: -0.5, sphere: 1 },
        rightEye: { cylinder: 0, sphere: 1 },
      }),
    (error) => error.code === "INVALID_CLINICAL_DATA",
  );
});

test("rechaza una distancia pupilar nula o negativa", () => {
  for (const pupillaryDistance of [0, -1]) {
    assert.throws(
      () =>
        validateCreatePrescriptionInput({
          leftEye: { cylinder: 0, sphere: 1 },
          pupillaryDistance,
          rightEye: { cylinder: 0, sphere: 1 },
        }),
      (error) => error.code === "INVALID_CLINICAL_DATA",
    );
  }
});

test("exige motivo y contenido para una adenda", () => {
  assert.throws(
    () => validateAddendumInput({ reason: "Corrección" }),
    (error) => error.code === "INVALID_CLINICAL_DATA",
  );
});
