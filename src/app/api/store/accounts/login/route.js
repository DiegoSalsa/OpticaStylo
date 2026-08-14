import { createStoreSessionCookie } from "@/auth/store-session";
import { loginStoreAccount } from "@/services/store-account-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { getRequestMetadata } from "@/utils/request-metadata";

export async function POST(request) {
  return executeApiHandler(async () => {
    const result = await loginStoreAccount(
      await readJsonBody(request),
      getRequestMetadata(request),
    );
    const response = createSuccessResponse({ account: result.account, session: result.session });
    response.headers.set("Set-Cookie", createStoreSessionCookie(result.token, result.maxAgeSeconds));
    return response;
  });
}
