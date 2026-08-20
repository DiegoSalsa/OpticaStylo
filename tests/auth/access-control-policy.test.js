import assert from "node:assert/strict";
import test from "node:test";

import {
  getPermissionsForRoles,
  ROLE_PERMISSIONS,
} from "../../src/auth/access-control-policy.js";
import { PERMISSION_CODES, PERMISSIONS } from "../../src/auth/permissions.js";
import { ROLE_CODES, ROLES } from "../../src/auth/roles.js";

test("define una política para cada rol conocido", () => {
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [...ROLE_CODES].sort());
});

test("no contiene códigos de permisos repetidos", () => {
  assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length);
});

test("combina permisos de varios roles sin duplicados", () => {
  const permissions = getPermissionsForRoles([ROLES.ADMIN, ROLES.SALES]);

  assert.equal(new Set(permissions).size, permissions.length);
  assert.ok(permissions.includes(PERMISSIONS.USERS_CREATE));
  assert.ok(permissions.includes(PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE));
});

test("el administrador no recibe acceso clínico", () => {
  const permissions = getPermissionsForRoles([ROLES.ADMIN]);

  assert.ok(permissions.includes(PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE));
  assert.ok(!permissions.includes(PERMISSIONS.MEDICAL_RECORDS_READ_ASSIGNED));
  assert.ok(!permissions.includes(PERMISSIONS.MEDICAL_RECORDS_WRITE_ASSIGNED));
  assert.ok(!permissions.includes(PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED));
});

test("ventas no recibe acceso a fichas clínicas", () => {
  const permissions = getPermissionsForRoles([ROLES.SALES]);

  assert.ok(permissions.includes(PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE));
  assert.ok(!permissions.includes(PERMISSIONS.MEDICAL_RECORDS_READ_ASSIGNED));
  assert.ok(!permissions.includes(PERMISSIONS.SCHEDULES_READ));
  assert.ok(!permissions.includes(PERMISSIONS.APPOINTMENTS_READ_ALL));
  assert.ok(!permissions.includes(PERMISSIONS.APPOINTMENTS_CREATE));
  assert.ok(!permissions.includes(PERMISSIONS.PATIENTS_READ_BASIC));
  assert.ok(!permissions.includes(PERMISSIONS.PATIENTS_MANAGE_BASIC));
});

test("el profesional solo administra su contexto clínico", () => {
  const permissions = getPermissionsForRoles([ROLES.CLINICAL_PROFESSIONAL]);

  assert.ok(permissions.includes(PERMISSIONS.APPOINTMENTS_READ_OWN));
  assert.ok(!permissions.includes(PERMISSIONS.APPOINTMENTS_READ_ALL));
  assert.ok(!permissions.includes(PERMISSIONS.SCHEDULES_MANAGE_ALL));
});
