import { AppError } from "../utils/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Validar el correo opcional sin aceptar campos arbitrarios para seleccionar pacientes.
function optionalEmail(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") invalidInput("El correo electrónico no es válido.");
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    invalidInput("El correo electrónico no es válido.");
  }
  return normalized;
}

// Validar exclusivamente los datos permitidos para el intento de vinculación.
export function validateCustomerPatientLinkInput(input, currentDate = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidInput("El cuerpo de la solicitud no es válido.");
  }
  const allowed = new Set(["birthDate", "email"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    invalidInput("El cuerpo de la solicitud no es válido.");
  }
  return {
    birthDate: birthDate(input.birthDate, currentDate),
    email: optionalEmail(input.email),
  };
}
