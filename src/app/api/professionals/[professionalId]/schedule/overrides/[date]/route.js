import { authenticateRequest } from "@/auth/authenticate-request";
import {
  deleteProfessionalOverride,
  setProfessionalOverride,
} from "@/services/schedule-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// PUT /api/professionals/[professionalId]/schedule/overrides/[date]/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PUT(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { date, professionalId } = await params;
    const input = await readJsonBody(request);
    const override = await setProfessionalOverride(
      professionalId,
      date,
      input,
      actor,
    );

    return createSuccessResponse(override);
  });
}

// DELETE /api/professionals/[professionalId]/schedule/overrides/[date]/ - eliminar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function DELETE(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { date, professionalId } = await params;

    await deleteProfessionalOverride(professionalId, date, actor);
    return new Response(null, { status: 204 });
  });
}
