// Capa HTTP para store/accounts/me/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest } from "@/auth/store-session";
import { getStoreAccountProfile } from "@/services/store-account-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeClinicalHandler } from "@/utils/error-handler";

// GET /api/store/accounts/me/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeClinicalHandler(async () => {
    return createPrivateStoreResponse(
      getStoreAccountProfile(await authenticateCustomerRequest(request)),
    );
  });
}
