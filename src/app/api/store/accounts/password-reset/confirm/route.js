import { expireStoreSessionCookie } from "@/auth/store-session";
import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS } from "@/security/public-request-rate-limit";
import { resetStorePassword } from "@/services/store-password-reset-service";
import { executeClinicalHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function POST(request) {
  return executeClinicalHandler(async () => {
    const input = await readJsonBody(request);
    await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET_CONFIRM, input?.challengeId);
    await resetStorePassword(input);
    const response = createPrivateStoreResponse({ updated: true });
    response.headers.set("Set-Cookie", expireStoreSessionCookie());
    return response;
  });
}
