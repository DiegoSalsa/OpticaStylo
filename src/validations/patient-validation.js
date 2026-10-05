import { normalizeChileanRut } from "../utils/chilean-rut.js";
import { AppError } from "../utils/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 150;
const MAX_RELATIONSHIP_LENGTH = 100;
const MAX_ADDRESS_LENGTH = 500;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function throwValidationError(message) {
  throw new AppError({
    code: "INVALID_PATIENT_DATA",
    message,
    status: 400,
  });
}

function validateRequiredText(value, fieldName, maximumLength) {
  if (typeof value !== "string") {
    throwValidationError(`${fieldName} es obligatorio.`);
  }

  const normalizedValue = value.trim().replace(/\s+/g, " ");

  if (!normalizedValue) {
    throwValidationError(`${fieldName} es obligatorio.`);
  }

  if (normalizedValue.length > maximumLength) {
    throwValidationError(
      `${fieldName} no puede superar ${maximumLength} caracteres.`,
    );
  }

  return normalizedValue;
}

function validateRut(value, fieldName) {
  const normalizedRut = normalizeChileanRut(value);

  if (!normalizedRut) {
    throwValidationError(`${fieldName} no es válido.`);
  }

  return normalizedRut;
}

function validateEmail(value, fieldName) {
  if (typeof value !== "string") {
    throwValidationError(`${fieldName} es obligatorio.`);
  }

  const normalizedEmail = value.trim().toLowerCase();

  if (
    normalizedEmail.length > 254 ||
    !EMAIL_PATTERN.test(normalizedEmail)
  ) {
    throwValidationError(`${fieldName} no es válido.`);
  }

  return normalizedEmail;
}

function validatePhone(value, fieldName) {
  if (typeof value !== "string") {
    throwValidationError(`${fieldName} es obligatorio.`);
  }

  const normalizedPhone = value.trim().replace(/[\s()-]/g, "");

  if (!/^\+?\d{8,15}$/.test(normalizedPhone)) {
    throwValidationError(`${fieldName} no es válido.`);
  }

  return normalizedPhone;
}

function validateBirthDate(value, currentDate) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throwValidationError("La fecha de nacimiento debe usar el formato AAAA-MM-DD.");
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
    throwValidationError("La fecha de nacimiento no es válida.");
  }

  const today = new Date(
    Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate(),
    ),
  );

  if (parsedDate > today) {
    throwValidationError("La fecha de nacimiento no puede ser futura.");
  }

  return value;
}

function isMinor(birthDate, currentDate) {
  const eighteenthBirthday = new Date(`${birthDate}T00:00:00.000Z`);
  eighteenthBirthday.setUTCFullYear(eighteenthBirthday.getUTCFullYear() + 18);

  return eighteenthBirthday > currentDate;
}

function validateGuardian(value, required) {
  if (value == null) {
    if (required) {
      throwValidationError(
        "Debe registrar un responsable para el paciente menor de edad.",
      );
    }

    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throwValidationError("Los datos del responsable no son válidos.");
  }

  return {
    email: validateEmail(value.email, "El correo del responsable"),
    firstNames: validateRequiredText(
      value.firstNames,
      "Los nombres del responsable",
      MAX_NAME_LENGTH,
    ),
    lastNames: validateRequiredText(
      value.lastNames,
      "Los apellidos del responsable",
      MAX_NAME_LENGTH,
    ),
    phone: validatePhone(value.phone, "El teléfono del responsable"),
    relationship: validateRequiredText(
      value.relationship,
      "El parentesco del responsable",
      MAX_RELATIONSHIP_LENGTH,
    ),
    rut: validateRut(value.rut, "El RUT del responsable"),
  };
}

export function validateCreatePatientInput(input, currentDate = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }

  const birthDate = validateBirthDate(input.birthDate, currentDate);

  return {
    address: validateRequiredText(
      input.address,
      "La dirección",
      MAX_ADDRESS_LENGTH,
    ),
    birthDate,
    email: validateEmail(input.email, "El correo electrónico"),
    firstNames: validateRequiredText(
      input.firstNames,
      "Los nombres",
      MAX_NAME_LENGTH,
    ),
    guardian: validateGuardian(
      input.guardian,
      isMinor(birthDate, currentDate),
    ),
    lastNames: validateRequiredText(
      input.lastNames,
      "Los apellidos",
      MAX_NAME_LENGTH,
    ),
    phone: validatePhone(input.phone, "El teléfono"),
    rut: validateRut(input.rut, "El RUT"),
  };
}

export function validateUpdatePatientInput(
  input,
  currentPatient,
  currentDate = new Date(),
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }

  const fields = [
    "address",
    "birthDate",
    "email",
    "firstNames",
    "guardian",
    "lastNames",
    "phone",
    "rut",
  ];

  if (!fields.some((field) => Object.hasOwn(input, field))) {
    throwValidationError("Debe indicar al menos un dato para actualizar.");
  }

  return validateCreatePatientInput(
    {
      ...currentPatient,
      ...input,
      guardian: Object.hasOwn(input, "guardian")
        ? input.guardian
        : currentPatient.guardian,
    },
    currentDate,
  );
}

export function validatePatientId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throwValidationError("El identificador del paciente no es válido.");
  }

  return value.toLowerCase();
}

export function validatePatientListQuery(searchParams) {
  const rawPage = searchParams.get("page") ?? "1";
  const rawPageSize = searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE);
  const page = Number(rawPage);
  const pageSize = Number(rawPageSize);

  if (!Number.isInteger(page) || page < 1) {
    throwValidationError("La página debe ser un número entero mayor que cero.");
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throwValidationError(
      `El tamaño de página debe estar entre 1 y ${MAX_PAGE_SIZE}.`,
    );
  }

  const search = (searchParams.get("search") ?? "").trim();

  if (search.length > 100) {
    throwValidationError("La búsqueda no puede superar 100 caracteres.");
  }

  return { page, pageSize, search };
}
