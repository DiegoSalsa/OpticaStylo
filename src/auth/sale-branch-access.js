import { assertBranchAccess, authorizedBranchIds } from "./branch-access.js";
import { hasGlobalBranchAccess } from "./permissions.js";
import { AppError } from "../utils/app-error.js";

export async function saleBranchScope(actor, branchId = null, client) {
  const selected = branchId ?? actor?.activeBranchId;
  if (selected) {
    await assertBranchAccess(actor, selected, client);
    return { allowedBranchIds: [selected] };
  }
  const allowedBranchIds = await authorizedBranchIds(actor, client);
  return allowedBranchIds ? { allowedBranchIds } : {};
}

export async function assertSaleBranch(sale, actor, client) {
  if (sale.branchId) return assertBranchAccess(actor, sale.branchId, client);
  if (!hasGlobalBranchAccess(actor)) {
    throw new AppError({ code: "SALE_BRANCH_ACCESS_DENIED", message: "La venta histórica está pendiente de conciliación.", status: 403 });
  }
}
