// Capa HTTP para store/orders/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest } from "@/auth/store-session";
import { getStoreOrders } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/orders/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    return createSuccessResponse(await getStoreOrders(
      await authenticateCustomerRequest(request),
    ));
  });
}
