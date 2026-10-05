import { authenticateCustomerRequest } from "@/auth/store-session";
import {
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
  enforcePublicRequestRateLimit,
} from "@/security/public-request-rate-limit";
import { requestCustomerPatientLinkCode } from "@/services/customer-clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// POST /api/store/accounts/me/patient-link/request-code - solicitar un OTP al correo del paciente verificado.
export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    // Limitar solicitudes por cuenta e IP antes de consultar o encolar información clínica.
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PATIENT_LINK,
      account.id,
    );
    return createSuccessResponse(await requestCustomerPatientLinkCode(account, await readJsonBody(request)));
  });
}
