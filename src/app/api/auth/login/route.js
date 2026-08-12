import { createSessionCookie } from "@/auth/session-cookie";
import { login } from "@/services/authentication-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { getRequestMetadata } from "@/utils/request-metadata";

export async function POST(request) {
  return executeApiHandler(async () => {
    const input = await readJsonBody(request);
    const result = await login(input, getRequestMetadata(request));
    const response = createSuccessResponse({
      session: result.session,
      user: result.user,
    });

    response.headers.set(
      "Set-Cookie",
      createSessionCookie(result.token, result.maxAgeSeconds),
    );

    return response;
  });
}
