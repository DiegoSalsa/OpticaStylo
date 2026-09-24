import { authenticateCustomerRequest } from "@/auth/store-session";
import {
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
  enforcePublicRequestRateLimit,
} from "@/security/public-request-rate-limit";
import { confirmCustomerPatientLink } from "@/services/customer-clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// POST /api/store/accounts/me/patient-link - consumir el OTP y completar la vinculación.
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    // Limitar intentos por cuenta e IP antes de consultar cualquier registro clínico.
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PATIENT_LINK_VERIFY,
      account.id,
    );
    return createSuccessResponse(await confirmCustomerPatientLink(account, await readJsonBody(request)));
  });
}
