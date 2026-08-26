import { authenticateRequest } from "@/auth/authenticate-request";
import { readPointOfSaleExternalPrescriptionImage } from "@/services/external-prescription-service";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readMultipartFormData } from "@/utils/http-request";
import { MAX_PRESCRIPTION_UPLOAD_BYTES } from "@/validations/store-validation";

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_PRESCRIPTION_EXTRACTION,
      actor.userId,
    );
    const form = await readMultipartFormData(request, MAX_PRESCRIPTION_UPLOAD_BYTES);
    return createSuccessResponse(await readPointOfSaleExternalPrescriptionImage({
      image: form.get("image"),
    }, actor));
  });
}
