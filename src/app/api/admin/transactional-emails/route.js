import { authenticateRequest } from "@/auth/authenticate-request";
import { getTransactionalEmailOperations } from "@/services/transactional-email-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getTransactionalEmailOperations(actor), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

