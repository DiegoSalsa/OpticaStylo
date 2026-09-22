import { authenticateRequest } from "@/auth/authenticate-request";
import { changeAppointmentStatus } from "@/services/appointment-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// PATCH /api/appointments/[appointmentId]/status/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { appointmentId } = await params;
    const input = await readJsonBody(request);
    const appointment = await changeAppointmentStatus(
      appointmentId,
      input,
      actor,
    );

    return createSuccessResponse(appointment);
  });
}
