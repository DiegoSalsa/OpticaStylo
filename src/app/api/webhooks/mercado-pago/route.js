// Capa HTTP para webhooks/mercado-pago/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { processMercadoPagoNotification } from "@/services/mercado-pago-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// POST /api/webhooks/mercado-pago/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const url = new URL(request.url);
    const body = await readJsonBody(request);
    const result = await processMercadoPagoNotification({
      body,
      dataId: url.searchParams.get("data.id"),
      requestId: request.headers.get("x-request-id"),
      signature: request.headers.get("x-signature"),
    });
    return createSuccessResponse(result);
  });
}
