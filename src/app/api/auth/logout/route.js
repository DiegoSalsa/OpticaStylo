import { authenticateRequest } from "@/auth/authenticate-request";
import { createExpiredSessionCookie } from "@/auth/session-cookie";
import { logout } from "@/services/authentication-service";
import { executeApiHandler } from "@/utils/error-handler";

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    await logout(actor);

    return new Response(null, {
      headers: { "Set-Cookie": createExpiredSessionCookie() },
      status: 204,
    });
  });
}
