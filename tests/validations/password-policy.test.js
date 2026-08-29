import assert from "node:assert/strict";
import test from "node:test";

import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
} from "../../src/validations/password-policy.js";
import { validatePasswordReset } from "../../src/validations/password-recovery-validation.js";
import { validateStoreAccountRegistration } from "../../src/validations/store-validation.js";
import { validateCreateUserInput } from "../../src/validations/user-validation.js";

const validPassword = "a".repeat(MINIMUM_PASSWORD_LENGTH);

test("comparte los mismos límites entre usuarios tienda y recuperación", () => {
  assert.equal(MINIMUM_PASSWORD_LENGTH, 15);
  assert.equal(MAXIMUM_PASSWORD_LENGTH, 128);
  assert.equal(validateCreateUserInput({
    email: "interno@example.test",
    firstName: "Nombre",
    lastName: "Apellido",
    password: validPassword,
    roles: ["SALES"],
  }).password, validPassword);
  assert.equal(validateStoreAccountRegistration({
    address: "Dirección de prueba",
    email: "cuenta@example.test",
    firstNames: "Nombre",
    lastNames: "Apellido",
    password: validPassword,
    phone: "+56912345678",
    rut: "12.345.678-5",
  }).password, validPassword);
  assert.equal(validatePasswordReset({
    password: validPassword,
    recoveryRequest: "00000000-0000-4000-8000-000000000061",
    recoveryToken: Buffer.alloc(32, 6).toString("base64url"),
  }).password, validPassword);
});
