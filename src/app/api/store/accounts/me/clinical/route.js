import { authenticateCustomerRequest } from "@/auth/store-session";
import { getCustomerClinicalOverview } from "@/services/customer-clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/accounts/me/clinical - obtener el resumen clínico permitido del paciente vinculado.
export async function GET(request) {
  return executeApiHandler(async () => createSuccessResponse(
    await getCustomerClinicalOverview(await authenticateCustomerRequest(request)),
  ));
}
