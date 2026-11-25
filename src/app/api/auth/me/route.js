// Capa HTTP para auth/me/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { selectActiveBranch } from "@/repositories/session-repository";
import { listInventoryBranches } from "@/repositories/inventory-repository";
import { readJsonBody } from "@/utils/http-request";
import { inventoryId } from "@/validations/inventory-validation";
import { authenticateRequest } from "@/auth/authenticate-request";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/auth/me/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse({
      activeBranchId: actor.activeBranchId,
      branches: (await listInventoryBranches(actor)).map(({ id, name }) => ({ id, name })),
      email: actor.email,
      expiresAt: actor.expiresAt,
      permissions: actor.permissions,
      roles: actor.roles,
      userId: actor.userId,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PATCH(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const input = await readJsonBody(request);
    const branchId = input?.branchId === null ? null : inventoryId(input?.branchId);
    return createSuccessResponse(await selectActiveBranch(actor, branchId), { headers: { "Cache-Control": "private, no-store" } });
  });
}
