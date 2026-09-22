import { authenticateRequest } from "@/auth/authenticate-request";
import { changeSaleStatus } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// PATCH /api/sales/[saleId]/status/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await changeSaleStatus(
      saleId, await readJsonBody(request), actor,
    ));
  });
}
