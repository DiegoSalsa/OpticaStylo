// Capa HTTP para admin/transactional-emails/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { getTransactionalEmailOperations } from "@/services/transactional-email-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/admin/transactional-emails/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getTransactionalEmailOperations(actor), {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

