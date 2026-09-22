import { authenticateRequest } from "@/auth/authenticate-request";
import { getSaleReceipt } from "@/services/sale-service";
import { executeApiHandler } from "@/utils/error-handler";
import { renderReceiptHtml } from "@/utils/receipt-template";

// GET /api/sales/[saleId]/receipt/print/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    const receiptId = new URL(request.url).searchParams.get("receiptId");
    const receipt = await getSaleReceipt(saleId, receiptId, actor);
    return new Response(renderReceiptHtml(receipt), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
