import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";

import {
  createPasswordRecoveryRequestId,
  derivePasswordRecoveryToken,
  getPasswordRecoveryConfiguration,
  hashPasswordRecoveryToken,
  PASSWORD_RECOVERY_SCOPES,
} from "../auth/password-recovery-token.js";
import { hashPassword } from "../auth/password.js";
import {
  consumePasswordRecoveryRequest,
  createPasswordRecoveryRequest,
  findPasswordRecoveryTarget,
  recordPasswordRecoveryAudit,
} from "../repositories/password-recovery-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validatePasswordRecoveryRequest,
  validatePasswordReset,
} from "../validations/password-recovery-validation.js";

const PASSWORD_RECOVERY_DURATION_MS = 15 * 60 * 1_000;
const PASSWORD_RECOVERY_MINIMUM_RESPONSE_MS = 500;
const PASSWORD_RECOVERY_RESPONSE_JITTER_MS = 150;

export const PASSWORD_RECOVERY_REQUEST_MESSAGE =
  "Si existe una cuenta asociada, recibirás instrucciones para restablecer la contraseña.";
export const PASSWORD_RESET_COMPLETED_MESSAGE =
  "La contraseña fue restablecida. Ya puedes iniciar sesión.";

function acceptedRecoveryRequest() {
  return { message: PASSWORD_RECOVERY_REQUEST_MESSAGE };
}

function invalidRecoveryRequest() {
  throw new AppError({
    code: "INVALID_OR_EXPIRED_PASSWORD_RECOVERY",
    message: "La solicitud de recuperación no es válida, ya fue utilizada o venció.",
    status: 400,
  });
}

function assertScope(scope) {
  if (!Object.values(PASSWORD_RECOVERY_SCOPES).includes(scope)) {
    throw new TypeError("El ámbito de recuperación no es válido.");
  }
}

function boundedRandom(value) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999_999, Math.max(0, value));
}

async function withEnumerationSafeTiming(operation, dependencies) {
  const readTime = dependencies.monotonicNow ?? (() => performance.now());
  const delay = dependencies.delay ?? wait;
  const startedAt = readTime();
  const random = boundedRandom((dependencies.random ?? Math.random)());
  const minimumDuration = PASSWORD_RECOVERY_MINIMUM_RESPONSE_MS
    + Math.floor(random * PASSWORD_RECOVERY_RESPONSE_JITTER_MS);

  try {
    return await operation();
  } finally {
    const remaining = minimumDuration - (readTime() - startedAt);
    if (remaining > 0) await delay(remaining);
  }
}

function recordSafeOperationalFailure(scope, dependencies) {
  const logger = dependencies.logger ?? console;
  try {
    logger.error(JSON.stringify({
      event: "password_recovery_request_unavailable",
      scope,
    }));
  } catch {
    return;
  }
}

export async function requestPasswordRecovery(
  scope,
  input,
  metadata = {},
  dependencies = {},
) {
  assertScope(scope);
  const { email } = validatePasswordRecoveryRequest(input);
  const findTarget = dependencies.findTarget ?? findPasswordRecoveryTarget;
  const audit = dependencies.recordAudit ?? recordPasswordRecoveryAudit;

  return withEnumerationSafeTiming(async () => {
    try {
      const target = await findTarget(scope, email);

      if (!target) {
        await audit({ event: "REQUEST_IGNORED", metadata, scope });
        return acceptedRecoveryRequest();
      }

      const configuration = (
        dependencies.getConfiguration ?? getPasswordRecoveryConfiguration
      )(dependencies.environment);
      const requestId = (dependencies.createRequestId ?? createPasswordRecoveryRequestId)();
      const token = (dependencies.deriveToken ?? derivePasswordRecoveryToken)({
        requestId,
        scope,
        tokenSecret: configuration.tokenSecret,
      });
      const now = dependencies.now?.() ?? new Date();
      await (dependencies.createRequest ?? createPasswordRecoveryRequest)({
        expiresAt: new Date(now.getTime() + PASSWORD_RECOVERY_DURATION_MS),
        metadata,
        requestId,
        scope,
        target,
        tokenHash: (dependencies.hashToken ?? hashPasswordRecoveryToken)(token),
      });
      return acceptedRecoveryRequest();
    } catch {
      recordSafeOperationalFailure(scope, dependencies);
      try {
        await audit({ event: "REQUEST_UNAVAILABLE", metadata, scope });
      } catch {
        return acceptedRecoveryRequest();
      }
      return acceptedRecoveryRequest();
    }
  }, dependencies);
}

export async function resetPasswordFromRecovery(
  scope,
  input,
  metadata = {},
  dependencies = {},
) {
  assertScope(scope);
  const reset = validatePasswordReset(input);
  const passwordHash = await (dependencies.hashPassword ?? hashPassword)(reset.password);
  const result = await (
    dependencies.consumeRequest ?? consumePasswordRecoveryRequest
  )({
    metadata,
    passwordHash,
    requestId: reset.requestId,
    scope,
    tokenHash: (dependencies.hashToken ?? hashPasswordRecoveryToken)(reset.token),
  });

  if (!result) invalidRecoveryRequest();
  return { message: PASSWORD_RESET_COMPLETED_MESSAGE };
}
