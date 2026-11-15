import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { hashPassword } from "../auth/password.js";
import { getTransactionalEmailConfig } from "../config/transactional-email.js";
import { prisma } from "../db/prisma.js";
import { assertPasswordResetStorageReady, consumePasswordReset, queuePasswordReset } from "../repositories/store-password-reset-repository.js";
import { AppError } from "../utils/app-error.js";
import { commerceCode, commerceCodeHash, verifyCommerceCode } from "../utils/commerce-otp.js";
import { encryptPasswordResetCode, PasswordResetEncryptionConfigError } from "../utils/store-password-reset-code.js";
import { PASSWORD_RESET_RESEND_SECONDS } from "../utils/store-password-reset-policy.js";
import { validateStorePasswordReset } from "../validations/store-validation.js";
import { processTransactionalEmailById } from "./transactional-email-service.js";

function unavailable() {
  return new AppError({
    code: "PASSWORD_RESET_EMAIL_UNAVAILABLE",
    message: "La recuperación por correo no está disponible. Comunícate con la óptica.",
    status: 503,
  });
}

function responseDelay(delay = wait) {
  const deadline = performance.now() + randomInt(220, 321);
  return () => delay(Math.max(0, deadline - performance.now()));
}

function storageUnavailable(error) {
  if (["P1000", "P1001", "P1002", "P1003", "P1010", "P1017", "P2021", "P2022", "P2024", "PASSWORD_RESET_STORAGE_NOT_READY"].includes(error?.code)) return true;
  return error?.code === "P2010" && ["42P01", "42703", "42501", "08006", "57P01"].includes(error.meta?.code);
}

export async function preparePasswordReset(email, schedule, dependencies = {}) {
  if ((dependencies.getEmailConfig ?? getTransactionalEmailConfig)().mode !== "live") throw unavailable();

  // Atenuar diferencias habituales entre buscar un correo y confirmar la escritura.
  const delayResponse = responseDelay(dependencies.wait);
  const challengeId = randomUUID();
  const code = commerceCode();
  let emailId;
  try {
    const protect = (value) => ({
      codeHash: commerceCodeHash(`password-reset:${challengeId}`, value),
      encryptedCode: encryptPasswordResetCode(challengeId, value, dependencies.environment),
    });
    // Validar ambas claves para cualquier correo. Nunca enviar los mismos dígitos que el desafío reemplazado.
    const candidate = protect(code);
    const protectCode = (previous) => {
      if (!previous || !verifyCommerceCode(`password-reset:${previous.id}`, code, previous.code_hash)) return candidate;
      const replacement = (Number(code) + randomInt(1, 1_000_000)) % 1_000_000;
      return protect(String(replacement).padStart(6, "0"));
    };
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await dependencies.limitAttempts?.();
    emailId = await (dependencies.database ?? prisma).$transaction(async (client) => {
      await assertPasswordResetStorageReady(client);
      await dependencies.reserveQuota?.(client);
      return (dependencies.queueReset ?? queuePasswordReset)({ challengeId, protectCode, email, expiresAt }, client);
    });
  } catch (error) {
    if (error instanceof PasswordResetEncryptionConfigError) throw unavailable();
    if (storageUnavailable(error)) {
      // Clasificación constante. Los errores del driver pueden contener los parámetros de la consulta.
      (dependencies.logger ?? console).error("Almacenamiento de recuperación no disponible.");
      throw unavailable();
    }
    throw error;
  } finally {
    await delayResponse();
  }
  if (emailId) {
    schedule(async () => {
      try {
        await (dependencies.sendEmail ?? processTransactionalEmailById)(emailId);
      } catch {
        // El worker periódico puede recuperar el mensaje y cualquier bloqueo abandonado.
        (dependencies.logger ?? console).error("Falló el despacho inmediato del correo de recuperación.");
      }
    });
  }
  return { challengeId, retryAfterSeconds: PASSWORD_RESET_RESEND_SECONDS };
}

export async function resetStorePassword(input, dependencies = {}) {
  const { challengeId, code, password } = validateStorePasswordReset(input);
  const delayResponse = responseDelay(dependencies.wait);
  const updated = await (dependencies.consumeReset ?? consumePasswordReset)({
    challengeId,
    code,
    makePasswordHash: () => (dependencies.hashPassword ?? hashPassword)(password),
  });
  if (!updated) {
    // Un identificador sintético y un código incorrecto deben fallar de forma parecida.
    await delayResponse();
    throw new AppError({
      code: "PASSWORD_RESET_INVALID",
      message: "El código es incorrecto, venció o alcanzó su límite de intentos. Puedes solicitar uno nuevo.",
      status: 409,
    });
  }
}
