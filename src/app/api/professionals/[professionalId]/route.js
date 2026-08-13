import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getProfessional,
  updateProfessional,
} from "@/services/professional-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const professional = await getProfessional(professionalId, actor);

    return createSuccessResponse(professional);
  });
}

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
