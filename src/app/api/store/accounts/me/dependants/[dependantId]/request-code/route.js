import { authenticateCustomerRequest } from "@/auth/store-session";
import { requestDependantCode } from "@/services/account-family-service";
import { executeApiHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS } from "@/security/public-request-rate-limit";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PATIENT_LINK, account.id);
    return createPrivateStoreResponse(await requestDependantCode(account, (await params).dependantId));
  });
}
