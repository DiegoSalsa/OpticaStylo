import { createStoreSessionCookie } from "@/auth/store-session";
import { loginStoreAccount } from "@/services/store-account-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { getRequestMetadata } from "@/utils/request-metadata";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";

export async function POST(request) {
  return executeApiHandler(async () => {
    const input = await readJsonBody(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_LOGIN,
      input?.email,
    );
    const result = await loginStoreAccount(
      input,
      getRequestMetadata(request),
    );
    const response = createSuccessResponse({ account: result.account, session: result.session });
    response.headers.set("Set-Cookie", createStoreSessionCookie(result.token, result.maxAgeSeconds));
    return response;
  });
}
