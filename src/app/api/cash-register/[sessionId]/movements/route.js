import { authenticateRequest } from "@/auth/authenticate-request";
import { getCashMovements, registerCashMovement } from "@/services/cash-register-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { readIdempotencyKey } from "@/utils/idempotency-key";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getCashMovements((await params).sessionId, actor, new URL(request.url).searchParams));
  });
}

// POST /api/cash-register/[sessionId]/movements/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { sessionId } = await params;
    return createSuccessResponse(await registerCashMovement(
      sessionId,
      await readJsonBody(request),
      actor,
      readIdempotencyKey(request),
      new URL(request.url).searchParams,
    ));
  });
}
