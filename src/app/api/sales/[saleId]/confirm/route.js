import { authenticateRequest } from "@/auth/authenticate-request";
import { confirmSale } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// POST /api/sales/[saleId]/confirm/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await confirmSale(saleId, actor));
  });
}
