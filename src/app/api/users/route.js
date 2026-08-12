import { authenticateRequest } from "@/auth/authenticate-request";
import { createUser } from "@/services/user-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const input = await readJsonBody(request);
    const user = await createUser(input, actor);

    return createSuccessResponse(user, { status: 201 });
  });
}
