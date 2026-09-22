// Capa HTTP para auth/login/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { createSessionCookie } from "@/auth/session-cookie";
import { login } from "@/services/authentication-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { getRequestMetadata } from "@/utils/request-metadata";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";

// POST /api/auth/login/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const input = await readJsonBody(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_LOGIN,
      input?.email,
    );
    const result = await login(input, getRequestMetadata(request));
    const response = createSuccessResponse({
      session: result.session,
      user: result.user,
    });

    response.headers.set(
      "Set-Cookie",
      createSessionCookie(result.token, result.maxAgeSeconds),
    );

    return response;
  });
}
