import { authenticateRequest } from "@/auth/authenticate-request";
import { createEncounter } from "@/services/clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const input = await readJsonBody(request, 64 * 1024);
    const encounter = await createEncounter(input, actor);

    return createSuccessResponse(encounter, { status: 201 });
  });
}
