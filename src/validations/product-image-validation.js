import { AppError } from "../utils/app-error.js";
import { hasSafeImageDimensions } from "./image-dimensions.js";

const IMAGE_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const HEIF_BRANDS = new Set(["heic", "heif", "heix", "hevc", "hevx", "mif1", "msf1"]);

export const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_UPLOAD_BYTES = MAX_PRODUCT_IMAGE_BYTES + 128 * 1024;

function fail(message, code = "INVALID_PRODUCT_IMAGE") {
  throw new AppError({ code, message, status: 400 });
}

function text(value, label, maximumLength) {
  if (typeof value !== "string") fail(`${label} es obligatorio.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) fail(`${label} es obligatorio.`);
  if (normalized.length > maximumLength) fail(`${label} no puede superar ${maximumLength} caracteres.`);
  return normalized;
}

function startsWith(data, signature, offset = 0) {
  if (data.length < offset + signature.length) return false;
  return signature.every((byte, index) => data[offset + index] === byte);
}

export function validateProductImage(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    fail("Debe adjuntar una imagen del producto.");
  }
  if (!IMAGE_TYPES.has(file.type)) {
    fail("La imagen debe ser JPEG, PNG, WEBP, HEIC o HEIF.");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PRODUCT_IMAGE_BYTES) {
    fail("La imagen del producto no puede superar 4 MiB.");
  }
  return {
    file,
    filename: text(file.name || "producto", "El nombre del archivo", 255)
      .replace(/[^\p{L}\p{N}._ -]/gu, "_"),
    mediaType: file.type,
    size: file.size,
  };
}

export function validateProductImageBytes(value, mediaType) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (data.length < 1 || data.length > MAX_PRODUCT_IMAGE_BYTES) {
    fail("La imagen del producto no puede superar 4 MiB.");
  }
  const valid = {
    "image/jpeg": startsWith(data, [0xff, 0xd8, 0xff]),
    "image/png": startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/webp": startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8),
    "image/heic": startsWith(data, [0x66, 0x74, 0x79, 0x70], 4)
      && HEIF_BRANDS.has(data.subarray(8, 12).toString("ascii")),
    "image/heif": startsWith(data, [0x66, 0x74, 0x79, 0x70], 4)
      && HEIF_BRANDS.has(data.subarray(8, 12).toString("ascii")),
  };
  if (!valid[mediaType]) {
    fail("El contenido del archivo no coincide con una imagen admitida.");
  }
  if (!hasSafeImageDimensions(data, mediaType)) {
    fail("La imagen supera las dimensiones permitidas o no contiene dimensiones vÃ¡lidas.");
  }
  return data;
}

export function validateProductImageAlt(value) {
  return text(value, "El texto alternativo", 300);
}
