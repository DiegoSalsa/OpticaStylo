import { prisma } from "../db/prisma.js";
import { branchAccessDenied } from "./branch-access.js";

export async function requireProfessionalBranch(professionalId, branchId, client = prisma) {
  if (!branchId || !await client.user_branches.findFirst({
    where: {
      user_id: professionalId, branch_id: branchId, branches: { is_active: true },
      users: { is_active: true, professional_profiles_professional_profiles_user_idTousers: { isNot: null } },
    },
    select: { user_id: true },
  })) throw branchAccessDenied();
}

export async function clinicalBranchIds(actor, client = prisma) {
  const rows = await client.user_branches.findMany({
    where: {
      user_id: actor.userId, branches: { is_active: true },
      ...(actor.activeBranchId && { branch_id: actor.activeBranchId }),
    },
    select: { branch_id: true },
  });
  return rows.map(({ branch_id }) => branch_id);
}
