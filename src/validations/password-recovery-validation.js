import { AppError } from "../utils/app-error.js";
import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
} from "./password-policy.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function fail(message) {
  throw new AppError({
    code: "INVALID_PASSWORD_RECOVERY_DATA",
    message,
    status: 400,
  });
}

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  return value;
}

function email(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    fail("El correo electrónico no es válido.");
  }
  return normalized;
}

function requestId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail("La solicitud de recuperación no es válida.");
  }
  return value.toLowerCase();
}

function token(value) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    fail("La solicitud de recuperación no es válida.");
  }
  return value;
}

function password(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("La contraseña es obligatoria.");
  }
  if (value.length < MINIMUM_PASSWORD_LENGTH) {
    fail(`La contraseña debe contener al menos ${MINIMUM_PASSWORD_LENGTH} caracteres.`);
  }
  if (value.length > MAXIMUM_PASSWORD_LENGTH) {
    fail(`La contraseña no puede superar ${MAXIMUM_PASSWORD_LENGTH} caracteres.`);
  }
  return value;
}

export function validatePasswordRecoveryRequest(input) {
  object(input);
  return { email: email(input.email) };
}

export function validatePasswordReset(input) {
  object(input);
  return {
    password: password(input.password),
    requestId: requestId(input.recoveryRequest),
    token: token(input.recoveryToken),
  };
}
