import { shippingLocations } from "@/services/shipping-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { getStoreCart } from "@/services/store-service";
export async function GET(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    await getStoreCart(getStoreCartToken(request), account);
    return createPrivateStoreResponse(await shippingLocations(new URL(request.url).searchParams.get("region")));
  }, { sensitive: true });
}
