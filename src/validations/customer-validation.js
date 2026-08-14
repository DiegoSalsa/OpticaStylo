import { normalizeChileanRut } from "../utils/chilean-rut.js";
import { AppError } from "../utils/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function fail(message) {
  throw new AppError({ code: "INVALID_CUSTOMER_DATA", message, status: 400 });
}

function text(value, label, maximumLength) {
  if (typeof value !== "string") fail(`${label} es obligatorio.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) fail(`${label} es obligatorio.`);
  if (normalized.length > maximumLength) {
    fail(`${label} no puede superar ${maximumLength} caracteres.`);
  }
  return normalized;
}

function rut(value) {
  const normalized = normalizeChileanRut(value);
  if (!normalized) fail("El RUT no es válido.");
  return normalized;
}

function email(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    fail("El correo electrónico no es válido.");
  }
  return normalized;
}

function phone(value) {
  const normalized = typeof value === "string"
    ? value.trim().replace(/[\s()-]/g, "")
    : "";
  if (!/^\+?\d{8,15}$/.test(normalized)) fail("El teléfono no es válido.");
  return normalized;
}

export function validateCustomerId(value, label = "cliente") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail(`El identificador del ${label} no es válido.`);
  }
  return value.toLowerCase();
}

function patientId(value) {
  if (value == null) return null;
  return validateCustomerId(value, "paciente");
}

export function validateCreateCustomerInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }

  const linkedPatientId = patientId(input.patientId);
  const suppliedDetails = ["rut", "firstNames", "lastNames", "phone", "email", "address"]
    .some((field) => Object.hasOwn(input, field));

  if (linkedPatientId && !suppliedDetails) {
    return { patientId: linkedPatientId, copyPatientData: true };
  }

  return {
    address: text(input.address, "La dirección", 500),
    email: email(input.email),
    firstNames: text(input.firstNames, "Los nombres", 150),
    lastNames: text(input.lastNames, "Los apellidos", 150),
    patientId: linkedPatientId,
    phone: phone(input.phone),
    rut: rut(input.rut),
  };
}

export function validateUpdateCustomerInput(input, current) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }

  const fields = ["rut", "firstNames", "lastNames", "phone", "email", "address"];
  if (!fields.some((field) => Object.hasOwn(input, field))) {
    fail("Debe indicar al menos un dato comercial para actualizar.");
  }

  const value = (field) => Object.hasOwn(input, field) ? input[field] : current[field];

  return validateCreateCustomerInput({
    address: value("address"),
    email: value("email"),
    firstNames: value("firstNames"),
    lastNames: value("lastNames"),
    patientId: current.patientId,
    phone: value("phone"),
    rut: value("rut"),
  });
}

export function validateCustomerListQuery(searchParams) {
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  const search = (searchParams.get("search") ?? "").trim();

  if (!Number.isInteger(page) || page < 1) fail("La página no es válida.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    fail(`El tamaño de página debe estar entre 1 y ${MAX_PAGE_SIZE}.`);
  }
  if (search.length > 100) fail("La búsqueda no puede superar 100 caracteres.");

  return { page, pageSize, search };
}
