import { randomBytes } from "node:crypto";

import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { PERMISSIONS } = await import("../src/auth/permissions.js");
const { prisma, disconnectPrisma } = await import("../src/db/prisma.js");
const { createUser, updateUser } = await import("../src/services/user-service.js");

const email = (process.env.POS_SALES_EMAIL ?? "ventas.pos@opticastylo.cl")
  .trim()
  .toLowerCase();
const password = process.env.POS_SALES_PASSWORD?.trim()
  || `${randomBytes(18).toString("base64url")}Aa1!`;

try {
  const admin = await prisma.users.findFirst({
    orderBy: { created_at: "asc" },
    select: { id: true },
    where: {
      is_active: true,
      user_roles_user_roles_user_idTousers: { some: { roles: { code: "ADMIN" } } },
    },
  });
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
  const existing = await prisma.users.findFirst({ select: { id: true }, where: { email } });
  const input = {
    email,
    firstName: "Ventas",
    lastName: "POS",
    password,
    roles: ["SALES"],
  };
  const user = existing
    ? await updateUser(existing.id, { ...input, isActive: true }, actor)
    : await createUser(input, actor);

  console.log(JSON.stringify({
    email: user.email,
    password,
    roles: user.roles,
    userId: user.id,
  }, null, 2));
} finally {
  await disconnectPrisma();
}
