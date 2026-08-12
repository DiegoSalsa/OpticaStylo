import assert from "node:assert/strict";
import test from "node:test";

import { ROLES } from "../../src/auth/roles.js";
import {
  validateCreateUserInput,
  validateLoginInput,
} from "../../src/validations/user-validation.js";

const validInput = {
  email: "Profesional@Example.com ",
  firstName: "  María   José ",
  lastName: "  Pérez  ",
  password: "una contraseña extensa",
  roles: [ROLES.CLINICAL_PROFESSIONAL],
};

test("normaliza los datos de un usuario válido", () => {
  const result = validateCreateUserInput(validInput);

  assert.deepEqual(result, {
    email: "profesional@example.com",
    firstName: "María José",
    lastName: "Pérez",
    password: validInput.password,
    roles: [ROLES.CLINICAL_PROFESSIONAL],
  });
});

test("elimina roles repetidos", () => {
  const result = validateCreateUserInput({
    ...validInput,
    roles: [ROLES.SALES, ROLES.SALES],
  });

  assert.deepEqual(result.roles, [ROLES.SALES]);
});

test("rechaza correos inválidos", () => {
  assert.throws(
    () => validateCreateUserInput({ ...validInput, email: "correo-inválido" }),
    (error) => error.code === "INVALID_USER_DATA" && error.status === 400,
  );
});

test("rechaza contraseñas menores a quince caracteres", () => {
  assert.throws(
    () => validateCreateUserInput({ ...validInput, password: "muy-corta" }),
    /al menos 15 caracteres/,
  );
});

test("rechaza roles desconocidos", () => {
  assert.throws(
    () => validateCreateUserInput({ ...validInput, roles: ["UNKNOWN"] }),
    /roles no son válidos/,
  );
});

test("el inicio de sesión acepta contraseñas anteriores más cortas", () => {
  assert.deepEqual(
    validateLoginInput({ email: "USER@EXAMPLE.COM", password: "anterior" }),
    { email: "user@example.com", password: "anterior" },
  );
});
