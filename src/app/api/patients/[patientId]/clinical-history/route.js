import { authenticateRequest } from "@/auth/authenticate-request";
import { getPatientClinicalHistory } from "@/services/clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/patients/[patientId]/clinical-history/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { patientId } = await params;
    const history = await getPatientClinicalHistory(patientId, actor);

    return createSuccessResponse(history);
  });
}
