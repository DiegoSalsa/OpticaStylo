import { authenticateCustomerRequest } from "@/auth/store-session";
import { confirmStoreAccountAge } from "@/services/store-account-service";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function PATCH(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(await confirmStoreAccountAge(
    await authenticateCustomerRequest(request), await readJsonBody(request),
  )));
}
