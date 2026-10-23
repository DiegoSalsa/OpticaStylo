import { prisma } from "../src/db/prisma.js";
import { requirePermissions } from "../src/auth/require-permission.js";
import { PERMISSIONS } from "../src/auth/permissions.js";

export async function productImageActor(userId) {
  const user = await prisma.users.findUnique({ where: { id: userId }, include: {
    user_roles_user_roles_user_idTousers: { include: { roles: { include: { role_permissions: { include: { permissions: true } } } } } },
  } });
  if (!user?.is_active || (user.locked_until && user.locked_until > new Date())) throw new Error("El usuario no está activo o está bloqueado.");
  const actor = { userId: user.id, permissions: [...new Set(user.user_roles_user_roles_user_idTousers.flatMap((role) => role.roles.role_permissions.map((item) => item.permissions.code)))] };
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  return actor;
}
