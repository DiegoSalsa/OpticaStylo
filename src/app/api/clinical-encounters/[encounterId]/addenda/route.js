import { authenticateRequest } from "@/auth/authenticate-request";
import { addEncounterAddendum } from "@/services/clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const input = await readJsonBody(request, 16 * 1024);
    const addendum = await addEncounterAddendum(encounterId, input, actor);

    return createSuccessResponse(addendum, { status: 201 });
  });
}
