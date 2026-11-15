import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class PasswordResetEncryptionConfigError extends Error {}

function encryptionKey(environment) {
  const key = environment.CUSTOMER_PASSWORD_RESET_ENCRYPTION_KEY?.trim();
  if (!/^[0-9a-f]{64}$/i.test(key ?? "")) {
    throw new PasswordResetEncryptionConfigError("Falta una clave válida para proteger los códigos de recuperación.");
  }
  return Buffer.from(key, "hex");
}

function context(challengeId) {
  return Buffer.from(`CUSTOMER_PASSWORD_RESET:v1:${challengeId}`);
}

export function encryptPasswordResetCode(challengeId, code, environment = process.env) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(environment), nonce);
  cipher.setAAD(context(challengeId));
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptPasswordResetCode(challengeId, encryptedCode, environment = process.env) {
  const envelope = Buffer.from(encryptedCode, "base64url");
  if (envelope.length !== 34) throw new Error("Código de recuperación protegido inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(environment), envelope.subarray(0, 12));
  decipher.setAAD(context(challengeId));
  decipher.setAuthTag(envelope.subarray(12, 28));
  const code = Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]).toString("utf8");
  if (!/^\d{6}$/.test(code)) throw new Error("Código de recuperación protegido inválido.");
  return code;
}
