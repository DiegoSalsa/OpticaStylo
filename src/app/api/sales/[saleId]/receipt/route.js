import { authenticateRequest } from "@/auth/authenticate-request";
import { getSaleReceipt, issueSaleReceipt } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/sales/[saleId]/receipt/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    const receiptId = new URL(request.url).searchParams.get("receiptId");
    return createSuccessResponse(await getSaleReceipt(saleId, receiptId, actor));
  });
}

// POST /api/sales/[saleId]/receipt/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await issueSaleReceipt(
      saleId,
      await readJsonBody(request),
      actor,
    ), { status: 201 });
  });
}
