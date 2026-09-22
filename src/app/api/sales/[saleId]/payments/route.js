import { authenticateRequest } from "@/auth/authenticate-request";
import { registerSalePayment } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { readIdempotencyKey } from "@/utils/idempotency-key";

// POST /api/sales/[saleId]/payments/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await registerSalePayment(
      saleId, await readJsonBody(request), actor, {
        requestKey: readIdempotencyKey(request),
      },
    ), { status: 201 });
  });
}
