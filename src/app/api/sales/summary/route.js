import { authenticateRequest } from "@/auth/authenticate-request";
import { getSaleSummary } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getSaleSummary(new URL(request.url).searchParams, actor));
  });
}
