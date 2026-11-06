import { requestCommerceCode } from "@/services/customer-commerce-link-service";
import { authenticateCustomerRequest } from "@/auth/store-session";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeClinicalHandler as execute } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS as OPS } from "@/security/public-request-rate-limit";
export async function POST(request) {
  return execute(async () => {
    const account = await authenticateCustomerRequest(request),
      input = await readJsonBody(request);
    await enforcePublicRequestRateLimit(request, OPS.STORE_COMMERCE_LINK, account?.id ?? input?.email);
    return response(await requestCommerceCode(input, account));
  });
}
