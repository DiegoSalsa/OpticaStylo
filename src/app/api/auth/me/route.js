// Capa HTTP para auth/me/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/auth/me/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse({
      email: actor.email,
      expiresAt: actor.expiresAt,
      permissions: actor.permissions,
      roles: actor.roles,
      userId: actor.userId,
    });
  });
}
