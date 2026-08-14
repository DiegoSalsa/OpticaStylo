import { authenticateRequest } from "@/auth/authenticate-request";
import { finalizeEncounter } from "@/services/clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const encounter = await finalizeEncounter(encounterId, actor);

    return createSuccessResponse(encounter);
  });
}
