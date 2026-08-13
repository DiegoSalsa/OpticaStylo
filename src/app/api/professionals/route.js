import { authenticateRequest } from "@/auth/authenticate-request";
import {
  createProfessional,
  getProfessionals,
} from "@/services/professional-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const professionals = await getProfessionals(actor);

    return createSuccessResponse(professionals);
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const input = await readJsonBody(request);
    const professional = await createProfessional(input, actor);

    return createSuccessResponse(professional, { status: 201 });
  });
}
