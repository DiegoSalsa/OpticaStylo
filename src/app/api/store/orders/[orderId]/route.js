import { authenticateCustomerRequest, getStoreOrderToken } from "@/auth/store-session";
import { getStoreOrder } from "@/services/store-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/orders/[orderId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const accountOnly = new URL(request.url).searchParams.get("scope") === "account";
    const account = await authenticateCustomerRequest(request, { optional: !accountOnly });
    const { orderId } = await params;
    return createSuccessResponse(await getStoreOrder(
      orderId, accountOnly ? null : getStoreOrderToken(request, orderId), account,
    ));
  });
}
