import { PASSWORD_RECOVERY_SCOPES } from "@/auth/password-recovery-token";
import {
  resetPasswordFromRecovery,
} from "@/services/password-recovery-service";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { getRequestMetadata } from "@/utils/request-metadata";

export async function POST(request) {
  return executeApiHandler(async () => {
    const input = await readJsonBody(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET,
      input?.recoveryRequest,
    );
    const result = await resetPasswordFromRecovery(
      PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
      input,
      getRequestMetadata(request),
    );
    return createSuccessResponse(result);
  });
}
