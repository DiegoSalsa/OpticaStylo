import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { selectCartClinicalPrescription } from "@/services/store-service";
import { executeClinicalHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function PUT(request) {
  return executeClinicalHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    const result = await selectCartClinicalPrescription(getStoreCartToken(request), account, await readJsonBody(request));
    return createPrivateStoreResponse(result);
  });
}
