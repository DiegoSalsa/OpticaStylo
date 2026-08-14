import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { checkoutCart } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createSuccessResponse(await checkoutCart(
      getStoreCartToken(request), account,
    ), { status: 201 });
  });
}
