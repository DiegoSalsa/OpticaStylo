// Capa HTTP para store/cart/prescription/image/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { getPrescriptionImage, putPrescriptionImage } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readMultipartFormData } from "@/utils/http-request";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";
import { MAX_PRESCRIPTION_UPLOAD_BYTES } from "@/validations/store-validation";

// PUT /api/store/cart/prescription/image/route.js - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PUT(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const token = getStoreCartToken(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_UPLOAD,
      account?.id ?? token,
    );
    const formData = await readMultipartFormData(request, MAX_PRESCRIPTION_UPLOAD_BYTES);
    return createSuccessResponse(await putPrescriptionImage(
      token, account, formData.get("image"),
    ));
  });
}

// GET /api/store/cart/prescription/image/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const image = await getPrescriptionImage(getStoreCartToken(request), account);
    return new Response(image.data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
        "Content-Type": image.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
