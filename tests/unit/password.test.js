import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "../../src/auth/password.js";

test("verifica la contraseña correcta", async () => {
  const password = "Otra-frase-segura-para-pruebas-2026";
  const storedHash = await hashPassword(password);

  assert.equal(await verifyPassword(password, storedHash), true);
});
