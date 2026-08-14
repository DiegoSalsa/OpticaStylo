import { authenticateCustomerRequest } from "@/auth/store-session";
import { getStoreOrders } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () => {
    return createSuccessResponse(await getStoreOrders(
      await authenticateCustomerRequest(request),
    ));
  });
}
