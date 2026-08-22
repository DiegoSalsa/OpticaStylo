import { randomBytes } from "node:crypto";

import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { PERMISSIONS } = await import("../src/auth/permissions.js");
const { executeQuery } = await import("../src/db/query.js");
const { createUser, updateUser } = await import("../src/services/user-service.js");

const email = (process.env.POS_SALES_EMAIL ?? "ventas.pos@opticastylo.cl")
  .trim()
  .toLowerCase();
const password = process.env.POS_SALES_PASSWORD?.trim()
  || `${randomBytes(18).toString("base64url")}Aa1!`;

const adminResult = await executeQuery(
  `SELECT users.id
   FROM users
   JOIN user_roles ON user_roles.user_id = users.id
   JOIN roles ON roles.id = user_roles.role_id
   WHERE users.is_active = TRUE AND roles.code = 'ADMIN'
   ORDER BY users.created_at
   LIMIT 1`,
);
const admin = adminResult.rows[0];
if (!admin) {
  throw new Error("Debe existir un administrador activo antes de crear la cuenta de ventas.");
}

const actor = {
  permissions: [
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.USERS_DEACTIVATE,
    PERMISSIONS.USERS_ASSIGN_ROLES,
  ],
  userId: admin.id,
};
const existingResult = await executeQuery(
  "SELECT id FROM users WHERE email = $1",
  [email],
);
const input = {
  email,
  firstName: "Ventas",
  lastName: "POS",
  password,
  roles: ["SALES"],
};
const user = existingResult.rows[0]
  ? await updateUser(existingResult.rows[0].id, { ...input, isActive: true }, actor)
  : await createUser(input, actor);

console.log(JSON.stringify({
  email: user.email,
  password,
  roles: user.roles,
  userId: user.id,
}, null, 2));
