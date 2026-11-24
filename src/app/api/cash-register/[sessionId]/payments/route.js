import { authenticateRequest } from "@/auth/authenticate-request";
import { getCashPayments } from "@/services/cash-register-service";
import { executeApiHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { sessionId } = await params;
    return createPrivateStoreResponse(await getCashPayments(sessionId, actor, new URL(request.url).searchParams));
  });
}
