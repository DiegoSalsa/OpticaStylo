import { ROLE_CODES } from "../auth/roles.js";
import { AppError } from "../utils/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function validateLoginPassword(value) {
  if (typeof value !== "string" || value.length === 0) {
    throwValidationError("La contraseña es obligatoria.");
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

export function validateLoginInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }

  return {
    email: validateEmail(input.email),
    password: validateLoginPassword(input.password),
  };
}

export function validateUserId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throwValidationError("El identificador del usuario no es válido.");
  }
  return value.toLowerCase();
}

export function validateUpdateUserInput(input, currentUser) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }
  const fields = ["email", "firstName", "isActive", "lastName", "password", "roles"];
  if (!fields.some((field) => Object.hasOwn(input, field))) {
    throwValidationError("Debe indicar al menos un dato para actualizar.");
  }
  if (Object.hasOwn(input, "isActive") && typeof input.isActive !== "boolean") {
    throwValidationError("El estado activo del usuario debe ser booleano.");
  }

  return {
    email: Object.hasOwn(input, "email") ? validateEmail(input.email) : currentUser.email,
    firstName: Object.hasOwn(input, "firstName")
      ? validateName(input.firstName, "El nombre")
      : currentUser.firstName,
    isActive: Object.hasOwn(input, "isActive") ? input.isActive : currentUser.isActive,
    lastName: Object.hasOwn(input, "lastName")
      ? validateName(input.lastName, "El apellido")
      : currentUser.lastName,
    password: Object.hasOwn(input, "password") ? validatePassword(input.password) : null,
    roles: Object.hasOwn(input, "roles") ? validateRoles(input.roles) : currentUser.roles,
  };
}

export function validateUserListQuery(searchParams) {
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "20");
  const search = (searchParams.get("search") ?? "").trim();
  if (!Number.isInteger(page) || page < 1) throwValidationError("La página no es válida.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throwValidationError("El tamaño de página debe estar entre 1 y 100.");
  }
  if (search.length > 100) throwValidationError("La búsqueda no puede superar 100 caracteres.");
  return { page, pageSize, search };
}
