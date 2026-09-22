// Capa HTTP para auth/logout/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { createExpiredSessionCookie } from "@/auth/session-cookie";
import { logout } from "@/services/authentication-service";
import { executeApiHandler } from "@/utils/error-handler";

// POST /api/auth/logout/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    await logout(actor);

    return new Response(null, {
      headers: { "Set-Cookie": createExpiredSessionCookie() },
      status: 204,
    });
  });
}
