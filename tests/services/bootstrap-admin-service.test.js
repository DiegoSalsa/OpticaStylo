import assert from "node:assert/strict";
import test from "node:test";

import { ROLES } from "../../src/auth/roles.js";
import { bootstrapInitialAdmin } from "../../src/services/bootstrap-admin-service.js";

const input = {
  email: "admin@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  password: "contraseña inicial suficientemente extensa",
};

test("crea el primer administrador con el rol fijo ADMIN", async () => {
  const expectedUser = { id: "admin-1", email: input.email };

  const user = await bootstrapInitialAdmin(input, {
    hashPassword: async () => "hash-seguro",
    createInitialAdmin: async (userData) => {
      assert.deepEqual(userData.roles, [ROLES.ADMIN]);
      assert.equal(userData.passwordHash, "hash-seguro");
      assert.equal(userData.password, undefined);
      return expectedUser;
    },
  });

  assert.equal(user, expectedUser);
});

test("impide inicializar otro administrador cuando ya existen usuarios", async () => {
  await assert.rejects(
    () =>
      bootstrapInitialAdmin(input, {
        hashPassword: async () => "hash-seguro",
        createInitialAdmin: async () => null,
      }),
    (error) =>
      error.code === "INITIAL_ADMIN_ALREADY_EXISTS" && error.status === 409,
  );
});
