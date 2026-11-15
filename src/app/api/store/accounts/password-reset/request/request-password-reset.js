import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS } from "../../../../../../security/public-request-rate-limit.js";
import { reservePublicRequestQuota } from "../../../../../../repositories/public-request-rate-limit-repository.js";
import { preparePasswordReset } from "../../../../../../services/store-password-reset-service.js";
import { executeClinicalHandler } from "../../../../../../utils/error-handler.js";
import { readJsonBody } from "../../../../../../utils/http-request.js";
import { createPrivateStoreResponse } from "../../../../../../utils/store-response.js";
import { validateStorePasswordResetRequest } from "../../../../../../validations/store-validation.js";

export function requestPasswordReset(request, schedule, { prepare = preparePasswordReset } = {}) {
  return executeClinicalHandler(async () => {
    const email = validateStorePasswordResetRequest(await readJsonBody(request));
    const result = await prepare(email, schedule, {
      limitAttempts: () => enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET_ATTEMPT, null),
      async reserveQuota(client) {
        const dependencies = { reserveQuota: (quota) => reservePublicRequestQuota(quota, client) };
        await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET_RESEND, email, dependencies);
        await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET_REQUEST, email, dependencies);
      },
    });
    return createPrivateStoreResponse(result, { status: 202 });
  });
}
