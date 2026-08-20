import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { retryStoreOrderCheckout } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const { orderId } = await params;
    return createSuccessResponse(await retryStoreOrderCheckout(
      orderId,
      getStoreCartToken(request),
      account,
    ));
  });
}
