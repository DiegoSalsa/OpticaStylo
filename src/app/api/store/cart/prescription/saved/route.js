import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { selectSavedAccountPrescription } from "@/services/store-service";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function PUT(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(await selectSavedAccountPrescription(
    getStoreCartToken(request), await authenticateCustomerRequest(request), await readJsonBody(request),
  )));
}
