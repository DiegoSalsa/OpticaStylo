import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password.js";
import { getTransactionalEmailConfig } from "../config/transactional-email.js";
import { consumePasswordReset, queuePasswordReset } from "../repositories/store-password-reset-repository.js";
import { AppError } from "../utils/app-error.js";
import { commerceCode, commerceCodeHash } from "../utils/commerce-otp.js";
import { validateStorePasswordReset } from "../validations/store-validation.js";
import { processTransactionalEmailById } from "./transactional-email-service.js";

export function preparePasswordReset(email, schedule, dependencies = {}) {
  const challengeId = randomUUID();
  const code = commerceCode();
  if ((dependencies.getEmailConfig ?? getTransactionalEmailConfig)().mode !== "live") {
    throw new AppError({
      code: "PASSWORD_RESET_EMAIL_UNAVAILABLE",
      message: "La recuperación por correo no está disponible. Comunícate con la óptica.",
      status: 503,
    });
  }
  // Validar la configuración del secreto antes de responder, incluso para correos desconocidos.
  commerceCodeHash(`password-reset:${challengeId}`, code);
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  schedule(async () => {
    const emailId = await (dependencies.queueReset ?? queuePasswordReset)({ challengeId, code, email, expiresAt });
    if (emailId) await (dependencies.sendEmail ?? processTransactionalEmailById)(emailId);
  });
  return { challengeId };
}

export async function resetStorePassword(input, dependencies = {}) {
  const { challengeId, code, password } = validateStorePasswordReset(input);
  const updated = await (dependencies.consumeReset ?? consumePasswordReset)({
    challengeId,
    code,
    makePasswordHash: () => (dependencies.hashPassword ?? hashPassword)(password),
  });
  if (!updated) {
    throw new AppError({
      code: "PASSWORD_RESET_INVALID",
      message: "El código es incorrecto, venció o alcanzó su límite de intentos. Puedes solicitar uno nuevo.",
      status: 409,
    });
  }
}
