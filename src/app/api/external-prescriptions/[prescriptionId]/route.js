import { authenticateRequest } from "@/auth/authenticate-request";
import { getExternalPrescription } from "@/services/external-prescription-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/external-prescriptions/[prescriptionId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { prescriptionId } = await params;
    return createSuccessResponse(await getExternalPrescription(prescriptionId, actor));
  });
}
