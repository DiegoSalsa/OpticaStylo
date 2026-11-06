import { authenticateCustomerRequest, getStoreOrderToken } from "@/auth/store-session";
import { getStoreOrderPrescription } from "@/services/store-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const { orderId } = await params;
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createPrivateStoreResponse(await getStoreOrderPrescription(orderId, getStoreOrderToken(request, orderId), account));
  });
}
