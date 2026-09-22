// Capa HTTP para sales/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { createSale, getSaleList } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { readIdempotencyKey } from "@/utils/idempotency-key";

// GET /api/sales/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getSaleList(new URL(request.url).searchParams, actor));
  });
}

// POST /api/sales/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const sale = await createSale(await readJsonBody(request), actor, {
      requestKey: readIdempotencyKey(request),
    });
    return createSuccessResponse(sale, { status: 201 });
  });
}
