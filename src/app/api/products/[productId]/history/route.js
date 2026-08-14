import { authenticateRequest } from "@/auth/authenticate-request";
import { getProductHistory } from "@/services/product-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    return createSuccessResponse(await getProductHistory(productId, actor));
  });
}
