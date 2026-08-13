import { authenticateRequest } from "@/auth/authenticate-request";
import {
  createPatient,
  getPatientList,
} from "@/services/patient-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const patients = await getPatientList(
      new URL(request.url).searchParams,
      actor,
    );

    return createSuccessResponse(patients);
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const input = await readJsonBody(request);
    const patient = await createPatient(input, actor);

    return createSuccessResponse(patient, { status: 201 });
  });
}
