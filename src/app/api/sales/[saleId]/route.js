import { authenticateRequest } from "@/auth/authenticate-request";
import { getSale, updateSaleDraft } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await getSale(saleId, actor));
  });
}

export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    const sale = await updateSaleDraft(saleId, await readJsonBody(request), actor);
    return createSuccessResponse(sale);
  });
}
