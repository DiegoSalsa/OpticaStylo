// Capa HTTP para store/accounts/logout/route.js, delegando autenticación y reglas de negocio a las capas internas.
import {
  authenticateCustomerRequest,
  expireStoreSessionCookie,
} from "@/auth/store-session";
import { logoutStoreAccount } from "@/services/store-account-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// POST /api/store/accounts/logout/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    await logoutStoreAccount(await authenticateCustomerRequest(request));
    const response = createSuccessResponse({ loggedOut: true });
    response.headers.set("Set-Cookie", expireStoreSessionCookie());
    return response;
  });
}
