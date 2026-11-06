import { quoteStoreShipping } from "@/services/shipping-service";
import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createPrivateStoreResponse(await quoteStoreShipping(getStoreCartToken(request), account, await readJsonBody(request)));
  }, { sensitive: true });
}
