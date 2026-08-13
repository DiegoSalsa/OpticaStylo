import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getPatient,
  updatePatient,
} from "@/services/patient-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { patientId } = await params;
    const patient = await getPatient(patientId, actor);

    return createSuccessResponse(patient);
  });
}

export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { patientId } = await params;
    const input = await readJsonBody(request);
    const patient = await updatePatient(patientId, input, actor);

    return createSuccessResponse(patient);
  });
}
