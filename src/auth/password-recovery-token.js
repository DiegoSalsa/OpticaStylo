import { createHash, createHmac, randomUUID } from "node:crypto";

export const PASSWORD_RECOVERY_SCOPES = Object.freeze({
  INTERNAL_USER: "INTERNAL_USER",
  STORE_ACCOUNT: "STORE_ACCOUNT",
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MINIMUM_SECRET_BYTES = 32;

export class PasswordRecoveryConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PasswordRecoveryConfigurationError";
  }
}

function normalizeScope(scope) {
  if (!Object.values(PASSWORD_RECOVERY_SCOPES).includes(scope)) {
    throw new TypeError("El ámbito de recuperación no es válido.");
  }
  return scope;
}

function normalizeRequestId(requestId) {
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
    throw new TypeError("El identificador de recuperación no es válido.");
  }
  return requestId.toLowerCase();
}

function normalizeOrigin(value, environment) {
  const rawOrigin = value?.trim() ?? "";
  if (!rawOrigin) {
    throw new PasswordRecoveryConfigurationError(
      "Falta configurar el origen público para recuperar contraseñas.",
    );
  }

  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new PasswordRecoveryConfigurationError(
      "El origen público para recuperar contraseñas no es válido.",
    );
  }

  if (
    !["http:", "https:"].includes(origin.protocol)
    || origin.username
    || origin.password
    || origin.pathname !== "/"
    || origin.search
    || origin.hash
  ) {
    throw new PasswordRecoveryConfigurationError(
      "El origen público para recuperar contraseñas no es válido.",
    );
  }

  if (environment.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new PasswordRecoveryConfigurationError(
      "El origen público de producción debe usar HTTPS.",
    );
  }

  return origin.origin;
}

function normalizeSecret(value) {
  const secret = value?.trim() ?? "";
  const bytes = Buffer.from(secret, "utf8");
  if (!secret || bytes.length < MINIMUM_SECRET_BYTES) {
    throw new PasswordRecoveryConfigurationError(
      "La clave de recuperación de contraseñas no es válida.",
    );
  }
  return bytes;
}

export function getPasswordRecoveryConfiguration(environment = process.env) {
  return {
    appOrigin: normalizeOrigin(environment.PASSWORD_RESET_APP_ORIGIN, environment),
    tokenSecret: normalizeSecret(environment.PASSWORD_RESET_TOKEN_SECRET),
  };
}

export function createPasswordRecoveryRequestId() {
  return randomUUID();
}

export function derivePasswordRecoveryToken({ requestId, scope, tokenSecret }) {
  const normalizedScope = normalizeScope(scope);
  const normalizedRequestId = normalizeRequestId(requestId);
  const secret = Buffer.isBuffer(tokenSecret)
    ? tokenSecret
    : Buffer.from(tokenSecret ?? "", "utf8");

  if (secret.length < MINIMUM_SECRET_BYTES) {
    throw new PasswordRecoveryConfigurationError(
      "La clave de recuperación de contraseñas no es válida.",
    );
  }

  return createHmac("sha256", secret)
    .update(`${normalizedScope}:${normalizedRequestId}`, "utf8")
    .digest("base64url");
}

export function hashPasswordRecoveryToken(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new TypeError("El token de recuperación no es válido.");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPasswordRecoveryUrl({ appOrigin, requestId, scope, token }) {
  const normalizedScope = normalizeScope(scope);
  const normalizedRequestId = normalizeRequestId(requestId);
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new TypeError("El token de recuperación no es válido.");
  }

  const path = normalizedScope === PASSWORD_RECOVERY_SCOPES.INTERNAL_USER
    ? "/ingresar"
    : "/cuenta";
  const url = new URL(path, appOrigin);
  url.searchParams.set("recoveryRequest", normalizedRequestId);
  url.searchParams.set("recoveryToken", token);
  return url.toString();
}
