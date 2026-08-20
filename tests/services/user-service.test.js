import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import { ROLES } from "../../src/auth/roles.js";
import { createUser, updateUser } from "../../src/services/user-service.js";

const actor = {
  permissions: [PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_ASSIGN_ROLES],
  userId: "00000000-0000-4000-8000-000000000001",
};
const input = {
  email: "ventas@example.com",
  firstName: "Ana",
  lastName: "Pérez",
  password: "contraseña extensa para ventas",
  roles: [ROLES.SALES],
};
const updateActor = {
  permissions: [
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.USERS_ASSIGN_ROLES,
    PERMISSIONS.USERS_DEACTIVATE,
  ],
  userId: actor.userId,
};
const targetId = "00000000-0000-4000-8000-000000000002";
const currentUser = {
  email: input.email,
  firstName: input.firstName,
  id: targetId,
  isActive: true,
  lastName: input.lastName,
  roles: [ROLES.SALES],
};

test("crea un usuario sin exponer la contraseña", async () => {
  const expectedUser = {
    id: "00000000-0000-4000-8000-000000000002",
    email: input.email,
    roles: input.roles,
  };

  const user = await createUser(input, actor, {
    hashPassword: async (password) => {
      assert.equal(password, input.password);
      return "hash-seguro-para-pruebas";
    },
    createUserWithRoles: async (userData, assignedBy) => {
      assert.equal(assignedBy, actor.userId);
      assert.equal(userData.passwordHash, "hash-seguro-para-pruebas");
      assert.equal(userData.password, undefined);
      return expectedUser;
    },
  });

  assert.equal(user, expectedUser);
  assert.ok(!Object.hasOwn(user, "password"));
  assert.ok(!Object.hasOwn(user, "passwordHash"));
});

test("comprueba permisos antes de calcular el hash", async () => {
  let hashWasCalled = false;

  await assert.rejects(
    () =>
      createUser(input, { userId: actor.userId, permissions: [] }, {
        hashPassword: async () => {
          hashWasCalled = true;
        },
      }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS",
  );

  assert.equal(hashWasCalled, false);
});

test("convierte correos duplicados en un conflicto de dominio", async () => {
  await assert.rejects(
    () =>
      createUser(input, actor, {
        hashPassword: async () => "hash-seguro-para-pruebas",
        createUserWithRoles: async () => {
          const error = new Error("duplicate key");
          error.code = "23505";
          throw error;
        },
      }),
    (error) => error.code === "USER_EMAIL_ALREADY_EXISTS" && error.status === 409,
  );
});

test("actualiza roles y revoca sesiones activas", async () => {
  const result = await updateUser(targetId, { roles: [ROLES.ADMIN] }, updateActor, {
    findUserById: async () => currentUser,
    updateUserWithRoles: async (id, data, assignedBy) => {
      assert.equal(id, targetId);
      assert.equal(assignedBy, updateActor.userId);
      assert.equal(data.revokeSessions, true);
      return { reason: null, user: { ...currentUser, roles: data.roles } };
    },
  });
  assert.deepEqual(result.roles, [ROLES.ADMIN]);
});

test("impide desactivar la cuenta actualmente autenticada", async () => {
  await assert.rejects(
    () => updateUser(updateActor.userId, { isActive: false }, updateActor, {
      findUserById: async () => ({ ...currentUser, id: updateActor.userId }),
    }),
    (error) => error.code === "CANNOT_DEACTIVATE_CURRENT_USER" && error.status === 409,
  );
});

test("conserva al último administrador activo", async () => {
  await assert.rejects(
    () => updateUser(targetId, { roles: [ROLES.SALES] }, updateActor, {
      findUserById: async () => ({ ...currentUser, roles: [ROLES.ADMIN] }),
      updateUserWithRoles: async () => ({ reason: "LAST_ACTIVE_ADMIN", user: null }),
    }),
    (error) => error.code === "LAST_ACTIVE_ADMIN" && error.status === 409,
  );
});
