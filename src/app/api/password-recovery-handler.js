import {
  PASSWORD_RECOVERY_REQUEST_MESSAGE,
  requestPasswordRecovery,
  resetPasswordFromRecovery,
} from "../../services/password-recovery-service.js";
import { enforcePublicRequestRateLimit } from "../../security/public-request-rate-limit.js";
import { createSuccessResponse } from "../../utils/api-response.js";
import { readJsonBody } from "../../utils/http-request.js";
import { getRequestMetadata } from "../../utils/request-metadata.js";

export async function handlePasswordRecoveryRequest(
  request,
  { operation, scope },
  dependencies = {},
) {
  const input = await (dependencies.readBody ?? readJsonBody)(request);
  await (dependencies.enforceRateLimit ?? enforcePublicRequestRateLimit)(
    request,
    operation,
    input?.email,
  );
  await (dependencies.requestRecovery ?? requestPasswordRecovery)(
    scope,
    input,
    (dependencies.getMetadata ?? getRequestMetadata)(request),
  );
  return (dependencies.successResponse ?? createSuccessResponse)(
    { message: PASSWORD_RECOVERY_REQUEST_MESSAGE },
    { status: 202 },
  );
}

export async function handlePasswordResetRequest(
  request,
  { operation, scope },
  dependencies = {},
) {
  const input = await (dependencies.readBody ?? readJsonBody)(request);
  await (dependencies.enforceRateLimit ?? enforcePublicRequestRateLimit)(
    request,
    operation,
    input?.recoveryRequest,
  );
  const result = await (dependencies.resetPassword ?? resetPasswordFromRecovery)(
    scope,
    input,
    (dependencies.getMetadata ?? getRequestMetadata)(request),
  );
  return (dependencies.successResponse ?? createSuccessResponse)(result);
}
