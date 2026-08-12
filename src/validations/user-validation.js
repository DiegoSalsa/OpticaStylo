import { ROLE_CODES } from "../auth/roles.js";
import { AppError } from "../utils/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 100;

function throwValidationError(message) {
  throw new AppError({
    code: "INVALID_USER_DATA",
    message,
    status: 400,
  });
}

function validateName(value, fieldName) {
  if (typeof value !== "string") {
    throwValidationError(`${fieldName} es obligatorio.`);
  }

  const normalizedValue = value.trim().replace(/\s+/g, " ");

  if (!normalizedValue) {
    throwValidationError(`${fieldName} es obligatorio.`);
  }

  if (normalizedValue.length > MAX_NAME_LENGTH) {
    throwValidationError(`${fieldName} no puede superar 100 caracteres.`);
  }

  return normalizedValue;
}

function validateEmail(value) {
  if (typeof value !== "string") {
    throwValidationError("El correo electrónico es obligatorio.");
  }

  const normalizedEmail = value.trim().toLowerCase();

  if (
    normalizedEmail.length > 254 ||
    !EMAIL_PATTERN.test(normalizedEmail)
  ) {
    throwValidationError("El correo electrónico no es válido.");
  }

  return normalizedEmail;
}

function validatePassword(value) {
  if (typeof value !== "string") {
    throwValidationError("La contraseña es obligatoria.");
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    throwValidationError(
      `La contraseña debe contener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }

  if (value.length > MAX_PASSWORD_LENGTH) {
    throwValidationError(
      `La contraseña no puede superar ${MAX_PASSWORD_LENGTH} caracteres.`,
    );
  }

  return value;
}

function validateRoles(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throwValidationError("Debe asignar al menos un rol al usuario.");
  }

  const uniqueRoles = [...new Set(value)];

  if (
    uniqueRoles.some(
      (roleCode) =>
        typeof roleCode !== "string" || !ROLE_CODES.includes(roleCode),
    )
  ) {
    throwValidationError("Uno o más roles no son válidos.");
  }

  return uniqueRoles;
}

export function validateCreateUserInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }

  return {
    email: validateEmail(input.email),
    firstName: validateName(input.firstName, "El nombre"),
    lastName: validateName(input.lastName, "El apellido"),
    password: validatePassword(input.password),
    roles: validateRoles(input.roles),
  };
}
