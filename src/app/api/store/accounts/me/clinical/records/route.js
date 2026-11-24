import { authenticateCustomerRequest } from "@/auth/store-session";
import { getCustomerClinicalPage } from "@/services/customer-clinical-service";
import { executeApiHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function GET(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    return createPrivateStoreResponse(await getCustomerClinicalPage(account, new URL(request.url).searchParams));
  });
}
