// Capa HTTP para store/cart/checkout/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest, createStoreOrderCookie, getStoreCartToken } from "@/auth/store-session";
import { checkoutCart } from "@/services/store-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";

// POST /api/store/cart/checkout/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const token = getStoreCartToken(request);
    const result = await checkoutCart(token, account);
    const response = createSuccessResponse(result, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    response.headers.set("Set-Cookie", createStoreOrderCookie(result.order.id, token, 30 * 24 * 60 * 60));
    return response;
  });
}
