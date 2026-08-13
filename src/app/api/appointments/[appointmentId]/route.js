import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getAppointment,
  updateAppointment,
} from "@/services/appointment-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { appointmentId } = await params;
    const appointment = await getAppointment(appointmentId, actor);

    return createSuccessResponse(appointment);
  });
}

export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { appointmentId } = await params;
    const input = await readJsonBody(request);
    const appointment = await updateAppointment(appointmentId, input, actor);

    return createSuccessResponse(appointment);
  });
}
