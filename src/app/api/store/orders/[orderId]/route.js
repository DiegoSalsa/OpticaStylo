import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { getStoreOrder } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const { orderId } = await params;
    return createSuccessResponse(await getStoreOrder(
      orderId, getStoreCartToken(request), account,
    ));
  });
}
