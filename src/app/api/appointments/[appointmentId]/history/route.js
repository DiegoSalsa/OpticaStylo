import { authenticateRequest } from "@/auth/authenticate-request";
import { getAppointmentHistory } from "@/services/appointment-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { appointmentId } = await params;
    const history = await getAppointmentHistory(appointmentId, actor);

    return createSuccessResponse(history);
  });
}
