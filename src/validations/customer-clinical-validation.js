import { AppError } from "../utils/app-error.js";

// Lanzar un error uniforme para entradas inválidas del vínculo clínico.
function invalidInput(message) {
  throw new AppError({ code: "INVALID_CUSTOMER_PATIENT_LINK", message, status: 400 });
}

// Validar y normalizar la fecha de nacimiento ingresada como verificación adicional.
function birthDate(value, currentDate = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalidInput("La fecha de nacimiento debe usar el formato AAAA-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  const today = new Date(Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    currentDate.getUTCDate(),
  ));
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalidInput("La fecha de nacimiento no es válida.");
  }
  if (parsed > today) invalidInput("La fecha de nacimiento no puede ser futura.");
  return value;
}

// Validar exclusivamente la fecha permitida para solicitar un desafío de vinculación.
export function validateCustomerPatientLinkRequest(input, currentDate = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidInput("El cuerpo de la solicitud no es válido.");
  }
  const allowed = new Set(["birthDate"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    invalidInput("El cuerpo de la solicitud no es válido.");
  }
  return {
    birthDate: birthDate(input.birthDate, currentDate),
  };
}

// Validar exclusivamente el código OTP que puede confirmar la vinculación.
export function validateCustomerPatientOtpInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidInput("El cuerpo de la solicitud no es válido.");
  if (Object.keys(input).some((key) => key !== "code")) {
    invalidInput("El cuerpo de la solicitud no es válido.");
  }
  if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) {
    invalidInput("El código de vinculación no es válido.");
  }
  return { code: input.code };
}
