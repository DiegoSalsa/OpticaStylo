import { validateCreatePrescriptionInput } from "./clinical-validation.js";
import { normalizeChileanRut } from "../utils/chilean-rut.js";
import { AppError } from "../utils/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const MAX_PRESCRIPTION_IMAGE_BYTES = 8 * 1024 * 1024;

function fail(message, code = "INVALID_STORE_DATA") {
  throw new AppError({ code, message, status: 400 });
}

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  return value;
}

function text(value, label, maximumLength, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  if (typeof value !== "string") fail(`${label} es obligatorio.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) fail(`${label} es obligatorio.`);
  if (normalized.length > maximumLength) {
    fail(`${label} no puede superar ${maximumLength} caracteres.`);
  }
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

function rut(value) {
  const normalized = normalizeChileanRut(value);
  if (!normalized) fail("El RUT no es válido.");
  return normalized;
}

function uuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail(`El identificador de ${label} no es válido.`);
  }
  return value.toLowerCase();
}

function password(value, { allowLegacy = false } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    fail("La contraseña es obligatoria.");
  }
  if (!allowLegacy && value.length < 15) {
    fail("La contraseña debe contener al menos 15 caracteres.");
  }
  if (value.length > 128) fail("La contraseña no puede superar 128 caracteres.");
  return value;
}

export function validateStoreAccountRegistration(input) {
  object(input);
  return {
    address: text(input.address, "La dirección", 500),
    email: email(input.email),
    firstNames: text(input.firstNames, "Los nombres", 150),
    lastNames: text(input.lastNames, "Los apellidos", 150),
    password: password(input.password),
    phone: phone(input.phone),
    rut: rut(input.rut),
  };
}

export function validateStoreLogin(input) {
  object(input);
  return { email: email(input.email), password: password(input.password, { allowLegacy: true }) };
}

export function validateStoreProductId(value) {
  return uuid(value, "producto");
}

export function validateCartItemInput(input) {
  object(input);
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
    fail("La cantidad debe ser un entero entre 1 y 100.");
  }
  return { quantity: input.quantity };
}

function buyer(value) {
  object(value);
  return {
    address: text(value.address, "La dirección del comprador", 500),
    email: email(value.email),
    firstNames: text(value.firstNames, "Los nombres del comprador", 150),
    lastNames: text(value.lastNames, "Los apellidos del comprador", 150),
    phone: phone(value.phone),
    rut: rut(value.rut),
  };
}

function fulfillment(value) {
  object(value);
  const method = typeof value.method === "string" ? value.method.trim().toUpperCase() : "";
  if (!new Set(["PICKUP", "DELIVERY"]).has(method)) {
    fail("La entrega debe ser retiro en tienda o despacho.");
  }
  if (method === "PICKUP") {
    return {
      address: null,
      city: null,
      method,
      notes: text(value.notes, "Las notas de entrega", 500, { nullable: true }),
      region: null,
    };
  }
  return {
    address: text(value.address, "La dirección de despacho", 500),
    city: text(value.city, "La comuna o ciudad", 120),
    method,
    notes: text(value.notes, "Las notas de entrega", 500, { nullable: true }),
    region: text(value.region, "La región", 120),
  };
}

export function validateCartConfiguration(input) {
  object(input);
  return {
    buyer: buyer(input.buyer),
    clinicalPrescriptionId: input.clinicalPrescriptionId == null
      ? null
      : uuid(input.clinicalPrescriptionId, "receta clínica"),
    fulfillment: fulfillment(input.fulfillment),
  };
}

export function validateExternalPrescriptionData(input) {
  const prescription = validateCreatePrescriptionInput(input);
  return {
    fulfillmentNotes: prescription.fulfillmentNotes,
    leftEye: prescription.leftEye,
    pupillaryDistance: prescription.pupillaryDistance,
    rightEye: prescription.rightEye,
  };
}

export function validatePrescriptionImage(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    fail("Debe adjuntar una imagen de la receta.", "INVALID_PRESCRIPTION_IMAGE");
  }
  if (!IMAGE_TYPES.has(file.type)) {
    fail("La receta debe ser una imagen JPEG, PNG, WEBP, HEIC o HEIF.", "INVALID_PRESCRIPTION_IMAGE");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PRESCRIPTION_IMAGE_BYTES) {
    fail("La imagen de la receta no puede superar 8 MiB.", "INVALID_PRESCRIPTION_IMAGE");
  }
  const filename = text(file.name || "receta", "El nombre del archivo", 255)
    .replace(/[^\p{L}\p{N}._ -]/gu, "_");
  return { file, filename, mediaType: file.type, size: file.size };
}

export function validateStoreOrderId(value) {
  return uuid(value, "pedido");
}

export function validateExternalPrescriptionId(value) {
  return uuid(value, "receta externa");
}
