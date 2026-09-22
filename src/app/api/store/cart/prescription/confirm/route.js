// Capa HTTP para store/cart/prescription/confirm/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { completeImagePrescription } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// PATCH /api/store/cart/prescription/confirm/route.js - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createSuccessResponse(await completeImagePrescription(
      getStoreCartToken(request), account, await readJsonBody(request),
    ));
  });
}
