import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import { requirePermissions } from "../../src/auth/require-permission.js";

test("permite una operación cuando existen todos los permisos", () => {
  const actor = {
    permissions: [PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_ASSIGN_ROLES],
  };

  assert.doesNotThrow(() =>
    requirePermissions(actor, [
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_ASSIGN_ROLES,
    ]),
  );
});

test("rechaza actores sin todos los permisos requeridos", () => {
  const actor = { permissions: [PERMISSIONS.USERS_CREATE] };

  assert.throws(
    () =>
      requirePermissions(actor, [
        PERMISSIONS.USERS_CREATE,
        PERMISSIONS.USERS_ASSIGN_ROLES,
      ]),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS" && error.status === 403,
  );
});

test("rechaza solicitudes no autenticadas", () => {
  assert.throws(
    () => requirePermissions(null, [PERMISSIONS.USERS_CREATE]),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && error.status === 401,
  );
});
