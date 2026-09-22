// Capa HTTP para store/accounts/me/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest } from "@/auth/store-session";
import { getStoreAccountProfile } from "@/services/store-account-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/accounts/me/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    return createSuccessResponse(
      getStoreAccountProfile(await authenticateCustomerRequest(request)),
    );
  });
}
