import { authenticateCustomerRequest } from "@/auth/store-session";
import { getCustomerClinicalOverview } from "@/services/customer-clinical-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/accounts/me/clinical - obtener el resumen clínico permitido del paciente vinculado.
export async function GET(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(
    await getCustomerClinicalOverview(await authenticateCustomerRequest(request), { dependantId: new URL(request.url).searchParams.get("dependantId") }),
  ));
}
