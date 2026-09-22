import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getMedicalRecord,
  updateMedicalRecord,
} from "@/services/clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

const CLINICAL_BODY_LIMIT = 64 * 1024;

// GET /api/patients/[patientId]/medical-record/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { patientId } = await params;
    const record = await getMedicalRecord(patientId, actor);

    return createSuccessResponse(record);
  });
}

// PATCH /api/patients/[patientId]/medical-record/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { patientId } = await params;
    const input = await readJsonBody(request, CLINICAL_BODY_LIMIT);
    const record = await updateMedicalRecord(patientId, input, actor);

    return createSuccessResponse(record);
  });
}
