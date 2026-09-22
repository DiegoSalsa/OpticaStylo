import { authenticateRequest } from "@/auth/authenticate-request";
import { closeCashRegister } from "@/services/cash-register-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// POST /api/cash-register/[sessionId]/close/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { sessionId } = await params;
    return createSuccessResponse(await closeCashRegister(
      sessionId,
      await readJsonBody(request),
      actor,
    ));
  });
}
