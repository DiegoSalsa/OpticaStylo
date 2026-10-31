import { prisma } from "../db/prisma.js";
import { inventoryBranchAccess, inventoryError } from "../repositories/inventory-repository.js";
export async function saleBranchScope(actor,branchId) {
  if(branchId) await inventoryBranchAccess(actor,branchId);
  if(actor.permissions.includes("inventory.manage_all")) return {};
  const rows=await prisma.user_branches.findMany({where:{user_id:actor.userId},select:{branch_id:true}});
  return {allowedBranchIds:rows.map((r)=>r.branch_id),legacyActorId:actor.userId};
}
export async function assertSaleBranch(sale,actor) {
  if(sale.branchId) return inventoryBranchAccess(actor,sale.branchId);
  if(!actor.permissions.includes("inventory.manage_all") && sale.createdBy!==actor.userId) inventoryError("SALE_BRANCH_ACCESS_DENIED","No tiene autorización para consultar esta venta histórica.",403);
}
