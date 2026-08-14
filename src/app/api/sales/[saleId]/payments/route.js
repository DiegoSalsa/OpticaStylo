import { authenticateRequest } from "@/auth/authenticate-request";
import { registerSalePayment } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await registerSalePayment(
      saleId, await readJsonBody(request), actor,
    ), { status: 201 });
  });
}
