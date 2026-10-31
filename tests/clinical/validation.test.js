import assert from "node:assert/strict";
import { test } from "node:test";
import { clinicalAge, emptyClinicalFormData } from "../../src/config/clinical-forms.js";
import { validateClinicalFormData, clinicalDate } from "../../src/validations/clinical-form-validation.js";
import { validateCreateEncounterInput, validateUpdateEncounterInput } from "../../src/validations/clinical-validation.js";
import { contactologyData, optometryData, clinicalDemo } from "./data.js";
test("Los formatos oficiales conservan todos sus campos y la separación OD/OI", () => {
  assert.deepEqual(validateClinicalFormData("OPTOMETRY", optometryData()), optometryData());
  const d = contactologyData();
  const expected = structuredClone(d);
  expected.overRefraction.rightEye.sphere = 0.3;
  assert.deepEqual(validateClinicalFormData("CONTACTOLOGY", d, {
    final: true
  }), expected);
  assert.equal(emptyClinicalFormData("CONTACTOLOGY").trialLenses.length, 0);
});
test("Signos, precisión decimal, eje y lateralidad explícita", () => {
  let d = contactologyData();
  d.refraction.rightEye.axis = 181;
  assert.throws(() => validateClinicalFormData("CONTACTOLOGY", d));
  d = contactologyData();
  d.trialLenses[0].eye = null;
  assert.doesNotThrow(() => validateClinicalFormData("CONTACTOLOGY", d));
  assert.throws(() => validateClinicalFormData("CONTACTOLOGY", d, {
    final: true
  }));
  d = contactologyData();
  d.refraction.rightEye.sphere = 1.123;
  assert.throws(() => validateClinicalFormData("CONTACTOLOGY", d));
});
test("Borrador incompleto, autoría no suplantable y versión obligatoria", () => {
  assert.doesNotThrow(() => validateCreateEncounterInput({
    patientId: clinicalDemo.patientId,
    encounterType: "OPTOMETRY",
    encounterDate: "2026-01-01",
    formData: {}
  }));
  assert.throws(() => validateCreateEncounterInput({
    patientId: clinicalDemo.patientId,
    professionalId: clinicalDemo.colleagueId
  }));
  assert.throws(() => validateUpdateEncounterInput({
    anamnesis: "x"
  }));
});
test("Edad depende de la fecha clínica y fecha válida no futura", () => {
  assert.equal(clinicalAge("1995-10-31", "2026-10-30"), 30);
  assert.equal(clinicalAge("1995-10-31", "2026-10-31"), 31);
  assert.throws(() => clinicalDate("2026-02-30"));
  assert.throws(() => clinicalDate("2099-01-01"));
});
