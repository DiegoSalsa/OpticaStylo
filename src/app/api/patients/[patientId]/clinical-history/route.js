import { authenticateRequest } from "@/auth/authenticate-request";
import { getPatientClinicalHistory } from "@/services/clinical-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeClinicalHandler as executeApiHandler } from "@/utils/error-handler";

// GET /api/patients/[patientId]/clinical-history/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { patientId } = await params;
    const history = await getPatientClinicalHistory(patientId, actor,{page:new URL(request.url).searchParams.get("page")??1});

    return createSuccessResponse(history);
  });
}
