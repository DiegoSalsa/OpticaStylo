import { validateCreatePrescriptionInput } from "./clinical-validation.js";
import { normalizeChileanRut } from "../utils/chilean-rut.js";
import { AppError } from "../utils/app-error.js";
import { hasSafeImageDimensions } from "./image-dimensions.js";
import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
} from "./password-policy.js";

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
export const MAX_PRESCRIPTION_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PRESCRIPTION_UPLOAD_BYTES = MAX_PRESCRIPTION_IMAGE_BYTES + 128 * 1024;

const HEIF_BRANDS = new Set([
  "heic",
  "heif",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

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
  if (!allowLegacy && value.length < MINIMUM_PASSWORD_LENGTH) {
    fail(`La contraseña debe contener al menos ${MINIMUM_PASSWORD_LENGTH} caracteres.`);
  }
  if (value.length > MAXIMUM_PASSWORD_LENGTH) {
    fail(`La contraseña no puede superar ${MAXIMUM_PASSWORD_LENGTH} caracteres.`);
  }
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
  return {
    mountFrameProductId: input.mountFrameProductId == null
      ? null
      : uuid(input.mountFrameProductId, "montura"),
    quantity: input.quantity,
  };
}

export function validateCartItemsInput(input) {
  object(input);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 10) {
    fail("Debe indicar entre uno y diez productos para agregar al carrito.");
  }
  const items = input.items.map((item) => {
    const normalized = validateCartItemInput(item);
    return {
      mountFrameProductId: normalized.mountFrameProductId,
      productId: uuid(item.productId, "producto"),
      quantity: normalized.quantity,
    };
  });
  if (
    new Set(items.map((item) => `${item.productId}:${item.mountFrameProductId ?? ""}`)).size
    !== items.length
  ) {
    fail("No puede repetir un producto en la misma solicitud.");
  }
  return { items };
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
    fail("La imagen de la receta no puede superar 4 MiB.", "INVALID_PRESCRIPTION_IMAGE");
  }
  const filename = text(file.name || "receta", "El nombre del archivo", 255)
    .replace(/[^\p{L}\p{N}._ -]/gu, "_");
  return { file, filename, mediaType: file.type, size: file.size };
}

function bytesStartWith(data, signature, offset = 0) {
  if (data.length < offset + signature.length) return false;
  return signature.every((byte, index) => data[offset + index] === byte);
}

export function validatePrescriptionImageBytes(value, mediaType) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (data.length < 1 || data.length > MAX_PRESCRIPTION_IMAGE_BYTES) {
    fail("La imagen de la receta no puede superar 4 MiB.", "INVALID_PRESCRIPTION_IMAGE");
  }

  const matches = {
    "image/jpeg": bytesStartWith(data, [0xff, 0xd8, 0xff]),
    "image/png": bytesStartWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/webp": bytesStartWith(data, [0x52, 0x49, 0x46, 0x46])
      && bytesStartWith(data, [0x57, 0x45, 0x42, 0x50], 8),
    "image/heic": bytesStartWith(data, [0x66, 0x74, 0x79, 0x70], 4)
      && HEIF_BRANDS.has(data.subarray(8, 12).toString("ascii")),
    "image/heif": bytesStartWith(data, [0x66, 0x74, 0x79, 0x70], 4)
      && HEIF_BRANDS.has(data.subarray(8, 12).toString("ascii")),
  };

  if (!matches[mediaType]) {
    fail(
      "El contenido del archivo no coincide con una imagen admitida.",
      "INVALID_PRESCRIPTION_IMAGE",
    );
  }
  if (!hasSafeImageDimensions(data, mediaType)) {
    fail(
      "La imagen supera las dimensiones permitidas o no contiene dimensiones vÃ¡lidas.",
      "INVALID_PRESCRIPTION_IMAGE",
    );
  }
  return data;
}

export function validateStoreOrderId(value) {
  return uuid(value, "pedido");
}

export function validateExternalPrescriptionId(value) {
  return uuid(value, "receta externa");
}
