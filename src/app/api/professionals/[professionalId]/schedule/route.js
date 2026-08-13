import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getProfessionalSchedule,
  replaceProfessionalSchedule,
} from "@/services/schedule-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const schedule = await getProfessionalSchedule(professionalId, actor);

    return createSuccessResponse(schedule);
  });
}

export async function PUT(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const input = await readJsonBody(request);
    const schedule = await replaceProfessionalSchedule(
      professionalId,
      input,
      actor,
    );

    return createSuccessResponse(schedule);
  });
}
