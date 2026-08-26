import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { extractPrescriptionImage } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";

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
