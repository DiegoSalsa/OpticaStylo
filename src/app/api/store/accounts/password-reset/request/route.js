import { after } from "next/server";
import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS } from "@/security/public-request-rate-limit";
import { preparePasswordReset } from "@/services/store-password-reset-service";
import { executeClinicalHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { validateStorePasswordResetRequest } from "@/validations/store-validation";

export async function POST(request) {
  return executeClinicalHandler(async () => {
    const email = validateStorePasswordResetRequest(await readJsonBody(request));
    await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET_REQUEST, email);
    const result = preparePasswordReset(email, after);
    return createPrivateStoreResponse(result, { status: 202 });
  });
}
