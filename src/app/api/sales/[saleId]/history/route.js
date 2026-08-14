import { authenticateRequest } from "@/auth/authenticate-request";
import { getSaleHistory } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await getSaleHistory(saleId, actor));
  });
}
