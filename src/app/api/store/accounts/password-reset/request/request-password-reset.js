import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS } from "../../../../../../security/public-request-rate-limit.js";
import { preparePasswordReset } from "../../../../../../services/store-password-reset-service.js";
import { executeClinicalHandler } from "../../../../../../utils/error-handler.js";
import { readJsonBody } from "../../../../../../utils/http-request.js";
import { createPrivateStoreResponse } from "../../../../../../utils/store-response.js";
import { validateStorePasswordResetRequest } from "../../../../../../validations/store-validation.js";

export function requestPasswordReset(request, schedule, { prepare = preparePasswordReset } = {}) {
  return executeClinicalHandler(async () => {
    const email = validateStorePasswordResetRequest(await readJsonBody(request));
    await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET_RESEND, email);
    await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET_REQUEST, email);
    const result = await prepare(email, schedule);
    return createPrivateStoreResponse(result, { status: 202 });
  });
}
