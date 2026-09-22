import { AppError } from "../utils/app-error.js";
// Validaciones y normalización de entradas para professional-validation.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Construir y lanzar el error de dominio asociado a throw validation error
function throwValidationError(message) {
  throw new AppError({
    code: "INVALID_PROFESSIONAL_DATA",
    message,
    status: 400,
  });
}

// Validar y normalizar validate integer in range antes de continuar con la operación
function validateIntegerInRange(value, fieldName, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throwValidationError(
      `${fieldName} debe ser un número entero entre ${minimum} y ${maximum}.`,
    );
  }

  return value;
}

// Validar y normalizar validate profesional id antes de continuar con la operación
export function validateProfessionalId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throwValidationError("El identificador del profesional no es válido.");
  }

  return value.toLowerCase();
}

// Validar y normalizar validate create profesional entrada antes de continuar con la operación
export function validateCreateProfessionalInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }

  return {
    appointmentDurationMinutes: validateIntegerInRange(
      input.appointmentDurationMinutes,
      "La duración habitual",
      5,
      480,
    ),
    isBookable:
      input.isBookable === undefined
        ? true
        : validateBookable(input.isBookable),
    slotIntervalMinutes: validateIntegerInRange(
      input.slotIntervalMinutes,
      "El intervalo entre cupos",
      5,
      120,
    ),
    userId: validateProfessionalId(input.userId),
  };
}

// Validar y normalizar validate bookable antes de continuar con la operación
function validateBookable(value) {
  if (typeof value !== "boolean") {
    throwValidationError("La disponibilidad para reservas debe ser booleana.");
  }

  return value;
}

// Validar y normalizar validate update profesional entrada antes de continuar con la operación
export function validateUpdateProfessionalInput(input, currentProfessional) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }

  const fields = [
    "appointmentDurationMinutes",
    "isBookable",
    "slotIntervalMinutes",
  ];

  if (!fields.some((field) => Object.hasOwn(input, field))) {
    throwValidationError("Debe indicar al menos un dato para actualizar.");
  }

  return {
    appointmentDurationMinutes: validateIntegerInRange(
      input.appointmentDurationMinutes ??
        currentProfessional.appointmentDurationMinutes,
      "La duración habitual",
      5,
      480,
    ),
    isBookable: Object.hasOwn(input, "isBookable")
      ? validateBookable(input.isBookable)
      : currentProfessional.isBookable,
    slotIntervalMinutes: validateIntegerInRange(
      input.slotIntervalMinutes ?? currentProfessional.slotIntervalMinutes,
      "El intervalo entre cupos",
      5,
      120,
    ),
  };
}
