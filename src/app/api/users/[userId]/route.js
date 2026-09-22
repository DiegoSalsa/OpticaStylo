import { authenticateRequest } from "@/auth/authenticate-request";
import { getUser, updateUser } from "@/services/user-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/users/[userId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { userId } = await params;
    return createSuccessResponse(await getUser(userId, actor));
  });
}

// PATCH /api/users/[userId]/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { userId } = await params;
    return createSuccessResponse(await updateUser(
      userId,
      await readJsonBody(request),
      actor,
    ));
  });
}
