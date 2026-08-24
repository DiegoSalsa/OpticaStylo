import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getMercadoPagoCheckouts,
} from "@/services/mercado-pago-service";
import { createSuccessResponse } from "@/utils/api-response";
import { AppError } from "@/utils/app-error";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createSuccessResponse(await getMercadoPagoCheckouts(saleId, actor));
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    await authenticateRequest(request);
    throw new AppError({
      code: "MERCADO_PAGO_PRESENCIAL_NOT_CONFIGURED",
      message: "Mercado Pago presencial requiere vincular la cuenta comercial y su caja antes de cobrar.",
      status: 409,
    });
  });
}
