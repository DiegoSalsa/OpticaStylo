import { authenticateRequest } from "@/auth/authenticate-request";
import {
  createMercadoPagoCheckout,
  getMercadoPagoCheckouts,
} from "@/services/mercado-pago-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await getMercadoPagoCheckouts(saleId, actor));
  });
}

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    const checkout = await createMercadoPagoCheckout(saleId, actor);
    return createSuccessResponse(checkout, { status: 201 });
  });
}
