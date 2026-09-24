import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCustomerPatientLinkRequest,
  validateCustomerPatientOtpInput,
} from "../../src/validations/customer-clinical-validation.js";

test("valida únicamente la fecha para solicitar un desafío", () => {
  assert.deepEqual(validateCustomerPatientLinkRequest({ birthDate: "1990-05-20" }), { birthDate: "1990-05-20" });
});

test("rechaza patientId o correo receptor enviados desde el navegador", () => {
  assert.throws(() => validateCustomerPatientLinkRequest({ birthDate: "1990-05-20", patientId: "otro" }), /cuerpo de la solicitud no es válido/);
  assert.throws(() => validateCustomerPatientLinkRequest({ birthDate: "1990-05-20", email: "receptor@example.com" }), /cuerpo de la solicitud no es válido/);
});

test("valida el código OTP de seis dígitos", () => {
  assert.deepEqual(validateCustomerPatientOtpInput({ code: "123456" }), { code: "123456" });
  assert.throws(() => validateCustomerPatientOtpInput({ code: "12345" }), /código de vinculación no es válido/);
  assert.throws(() => validateCustomerPatientOtpInput({ code: "123456", patientId: "otro" }), /cuerpo de la solicitud no es válido/);
});
