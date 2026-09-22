// Capa HTTP para store/accounts/register/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { createStoreSessionCookie } from "@/auth/store-session";
import { registerStoreAccount } from "@/services/store-account-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { getRequestMetadata } from "@/utils/request-metadata";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";

// POST /api/store/accounts/register/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const input = await readJsonBody(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_REGISTRATION,
      input?.email ?? input?.rut,
    );
    const result = await registerStoreAccount(
      input,
      getRequestMetadata(request),
    );
    const response = createSuccessResponse({ account: result.account, session: result.session }, {
      status: 201,
    });
    response.headers.set("Set-Cookie", createStoreSessionCookie(result.token, result.maxAgeSeconds));
    return response;
  });
}
