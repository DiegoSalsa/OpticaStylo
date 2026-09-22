// Capa HTTP para store/cart/prescription/extract/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { extractPrescriptionImage } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";

// POST /api/store/cart/prescription/extract/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const token = getStoreCartToken(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_EXTRACTION,
      token,
    );
    return createSuccessResponse(await extractPrescriptionImage(
      token, account,
    ));
  });
}
