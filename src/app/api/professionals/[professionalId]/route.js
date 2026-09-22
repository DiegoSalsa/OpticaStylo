import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getProfessional,
  updateProfessional,
} from "@/services/professional-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/professionals/[professionalId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const professional = await getProfessional(professionalId, actor);

    return createSuccessResponse(professional);
  });
}

// PATCH /api/professionals/[professionalId]/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const input = await readJsonBody(request);
    const professional = await updateProfessional(
      professionalId,
      input,
      actor,
    );

    return createSuccessResponse(professional);
  });
}
