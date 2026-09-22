import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getPrescription,
  updatePrescription,
} from "@/services/prescription-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/prescriptions/[prescriptionId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { prescriptionId } = await params;
    const prescription = await getPrescription(prescriptionId, actor);

    return createSuccessResponse(prescription);
  });
}

// PATCH /api/prescriptions/[prescriptionId]/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { prescriptionId } = await params;
    const input = await readJsonBody(request);
    const prescription = await updatePrescription(
      prescriptionId,
      input,
      actor,
    );

    return createSuccessResponse(prescription);
  });
}
