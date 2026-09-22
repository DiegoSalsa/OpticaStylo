// Capa HTTP para store/cart/items/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { putStoreCartItems } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// POST /api/store/cart/items/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createSuccessResponse(await putStoreCartItems(
      getStoreCartToken(request),
      account,
      await readJsonBody(request),
    ));
  });
}
