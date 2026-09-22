// Capa HTTP para store/cart/checkout/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { checkoutCart } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// POST /api/store/cart/checkout/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createSuccessResponse(await checkoutCart(
      getStoreCartToken(request), account,
    ), { status: 201 });
  });
}
