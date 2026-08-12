import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "../../src/auth/password.js";

test("genera hashes diferentes para una misma contraseña", async () => {
  const password = "Una-frase-segura-para-pruebas-2026";
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.notEqual(firstHash, secondHash);
  assert.match(firstHash, /^scrypt\$131072\$8\$1\$/);
});

test("verifica la contraseña correcta", async () => {
  const password = "Otra-frase-segura-para-pruebas-2026";
  const storedHash = await hashPassword(password);

  assert.equal(await verifyPassword(password, storedHash), true);
});

test("rechaza una contraseña incorrecta", async () => {
  const storedHash = await hashPassword("Contraseña-correcta-para-pruebas");

  assert.equal(
    await verifyPassword("Contraseña-incorrecta-para-pruebas", storedHash),
    false,
  );
});

test("rechaza hashes almacenados con formato inválido", async () => {
  assert.equal(await verifyPassword("Contraseña-válida", "hash-inválido"), false);
});

test("rechaza contraseñas vacías", async () => {
  await assert.rejects(() => hashPassword(""), /cadena no vacía/);
});
