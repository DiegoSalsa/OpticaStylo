import { authenticateCustomerRequest, getStoreOrderToken } from "@/auth/store-session";
import { getCustomerShipment } from "@/services/shipping-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const { orderId } = await params;
    return createPrivateStoreResponse(await getCustomerShipment(orderId, getStoreOrderToken(request, orderId), await authenticateCustomerRequest(request, { optional: true })));
  }, { sensitive: true });
}
