import { authenticateCustomerRequest } from "@/auth/store-session";
import {
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
  enforcePublicRequestRateLimit,
} from "@/security/public-request-rate-limit";
import { linkCustomerPatient } from "@/services/customer-clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// POST /api/store/accounts/me/patient-link - verificar identidad y vincular la cuenta al paciente.
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    // Limitar intentos por cuenta e IP antes de consultar cualquier registro clínico.
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PATIENT_LINK,
      account.id,
    );
    return createSuccessResponse(await linkCustomerPatient(account, await readJsonBody(request)));
  });
}
