import { authenticateRequest } from "@/auth/authenticate-request";
import { getSale, updateSaleDraft } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/sales/[saleId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await getSale(saleId, actor));
  });
}

// PATCH /api/sales/[saleId]/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    const sale = await updateSaleDraft(saleId, await readJsonBody(request), actor);
    return createSuccessResponse(sale);
  });
}
