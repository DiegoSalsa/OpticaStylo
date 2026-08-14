import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getEncounter,
  updateEncounter,
} from "@/services/clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const encounter = await getEncounter(encounterId, actor);

    return createSuccessResponse(encounter);
  });
}

export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const input = await readJsonBody(request, 64 * 1024);
    const encounter = await updateEncounter(encounterId, input, actor);

    return createSuccessResponse(encounter);
  });
}
