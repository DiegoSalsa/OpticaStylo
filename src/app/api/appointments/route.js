import { authenticateRequest } from "@/auth/authenticate-request";
import {
  createAppointment,
  getAppointmentList,
} from "@/services/appointment-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const appointments = await getAppointmentList(
      new URL(request.url).searchParams,
      actor,
    );

    return createSuccessResponse(appointments);
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const input = await readJsonBody(request);
    const appointment = await createAppointment(input, actor);

    return createSuccessResponse(appointment, { status: 201 });
  });
}
