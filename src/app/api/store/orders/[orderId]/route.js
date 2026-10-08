import { authenticateCustomerRequest, getStoreOrderToken } from "@/auth/store-session";
import { getStoreOrder } from "@/services/store-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/orders/[orderId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const { orderId } = await params;
    return createSuccessResponse(await getStoreOrder(
      orderId, getStoreOrderToken(request, orderId), account,
    ));
  });
}
