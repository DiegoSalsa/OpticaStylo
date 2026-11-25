import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/app-error.js";
import { inventoryId } from "../validations/inventory-validation.js";
import { assertBranchAccess, authorizedBranchIds } from "./branch-access.js";

export async function operationBranch(actor, requested, { client = prisma, allowUnassigned = false } = {}) {
  const allowed = await authorizedBranchIds(actor, client);
  const selected = requested ?? actor.activeBranchId ?? (allowed?.length === 1 ? allowed[0] : null);
  if (!selected && allowUnassigned && !allowed) return null;
  if (!selected) throw new AppError({ code: "BRANCH_REQUIRED", message: "Seleccione una sucursal autorizada para esta operación.", status: 400 });
  const id = inventoryId(selected);
  await assertBranchAccess(actor, id, client);
  const branch = await client.branches.findFirst({ where: { id, is_active: true }, select: { id: true } });
  if (!branch) throw new AppError({ code: "BRANCH_UNAVAILABLE", message: "La sucursal no está habilitada.", status: 400 });
  return id;
}

export function customerIdentityScope(branchIds) {
  return branchIds ? { OR: [
    { customer_branches: { some: { branch_id: { in: branchIds } } } },
    { sales: { some: { branch_id: { in: branchIds } } } },
  ] } : {};
}

export function patientIdentityScope(branchIds) {
  return branchIds ? { patient_branches: { some: { branch_id: { in: branchIds } } } } : {};
}

export async function identityBranchIds(actor, client = prisma) {
  if (actor.activeBranchId) {
    await assertBranchAccess(actor, actor.activeBranchId, client);
    return [actor.activeBranchId];
  }
  return authorizedBranchIds(actor, client);
}
