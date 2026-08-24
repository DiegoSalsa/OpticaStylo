import { authenticateRequest } from "@/auth/authenticate-request";
import { registerCashMovement } from "@/services/cash-register-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { sessionId } = await params;
    return createSuccessResponse(await registerCashMovement(
      sessionId,
      await readJsonBody(request),
      actor,
    ));
  });
}
