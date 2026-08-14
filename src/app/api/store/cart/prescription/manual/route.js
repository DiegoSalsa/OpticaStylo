import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { putManualPrescription } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function PUT(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createSuccessResponse(await putManualPrescription(
      getStoreCartToken(request), account, await readJsonBody(request),
    ));
  });
}
