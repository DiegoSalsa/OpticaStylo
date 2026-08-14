import { authenticateCustomerRequest } from "@/auth/store-session";
import { getStoreAccountProfile } from "@/services/store-account-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () => {
    return createSuccessResponse(
      getStoreAccountProfile(await authenticateCustomerRequest(request)),
    );
  });
}
