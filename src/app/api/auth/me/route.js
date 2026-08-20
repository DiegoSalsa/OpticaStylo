import { authenticateRequest } from "@/auth/authenticate-request";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse({
      email: actor.email,
      expiresAt: actor.expiresAt,
      permissions: actor.permissions,
      roles: actor.roles,
      userId: actor.userId,
    });
  });
}
