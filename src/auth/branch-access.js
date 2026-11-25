import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/app-error.js";
import { hasGlobalBranchAccess } from "./permissions.js";

export function branchAccessDenied() {
  return new AppError({ code: "BRANCH_ACCESS_DENIED", message: "No tiene autorización para operar en esta sucursal.", status: 403 });
}

export async function authorizedBranchIds(actor, client = prisma) {
  if (hasGlobalBranchAccess(actor)) return null;
  if (!actor?.userId) return [];
  const rows = await client.user_branches.findMany({
    where: { user_id: actor.userId, branches: { is_active: true } },
    select: { branch_id: true },
  });
  return rows.map((row) => row.branch_id);
}

export async function assertBranchAccess(actor, branchId, client = prisma) {
  if (!branchId) throw branchAccessDenied();
  if (hasGlobalBranchAccess(actor)) return;
  if (!actor?.userId || !await client.user_branches.findFirst({
    where: { user_id: actor.userId, branch_id: branchId, branches: { is_active: true } },
    select: { user_id: true },
  })) throw branchAccessDenied();
}

export async function branchFilter(actor, branchId, client = prisma) {
  if (branchId) {
    await assertBranchAccess(actor, branchId, client);
    return { branch_id: branchId };
  }
  const allowed = await authorizedBranchIds(actor, client);
  return allowed ? { branch_id: { in: allowed } } : {};
}

export function requireGlobalBranchAccess(actor) {
  if (!hasGlobalBranchAccess(actor)) throw branchAccessDenied();
}
