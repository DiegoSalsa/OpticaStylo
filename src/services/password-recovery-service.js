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
  const target = await findTarget(scope, email);

  if (!target) {
    await audit({ event: "REQUEST_IGNORED", metadata, scope });
    return acceptedRecoveryRequest();
  }

  let configuration;
  try {
    configuration = (dependencies.getConfiguration ?? getPasswordRecoveryConfiguration)(
      dependencies.environment,
    );
  } catch {
    await audit({ event: "REQUEST_UNAVAILABLE", metadata, scope });
    return acceptedRecoveryRequest();
  }

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
