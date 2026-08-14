import { AppError } from "../utils/app-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_MEDIA_TYPES = Object.freeze(["image/png", "image/webp"]);

export const MAX_VIRTUAL_TRY_ON_IMAGE_BYTES = 5 * 1024 * 1024;

function fail(message) {
  throw new AppError({
    code: "INVALID_VIRTUAL_TRY_ON_DATA",
    message,
    status: 400,
  });
}

function decimal(value, label, minimum, maximum, defaultValue) {
  const normalized = value === null || value === undefined || value === ""
    ? defaultValue
    : Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    fail(`${label} debe estar entre ${minimum} y ${maximum}.`);
  }
  return Math.round(normalized * 1000) / 1000;
}

function optionalText(value, label, maximumLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") fail(`${label} no es válido.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maximumLength) {
    fail(`${label} no puede superar ${maximumLength} caracteres.`);
  }
  return normalized || null;
}

function normalizedFilename(value) {
  if (typeof value !== "string") fail("El nombre del archivo no es válido.");
  const filename = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!filename || filename.length > 255) {
    fail("El nombre del archivo debe tener entre 1 y 255 caracteres.");
  }
  return filename;
}

export function validateVirtualTryOnAssetId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail("El identificador del recurso virtual no es válido.");
  }
  return value.toLowerCase();
}

export function validateVirtualTryOnUpload(formData) {
  const image = formData?.get?.("image");
  if (!image || typeof image.arrayBuffer !== "function") {
    fail("Debe adjuntar una imagen PNG o WebP del marco.");
  }
  if (!ALLOWED_MEDIA_TYPES.includes(image.type)) {
    fail("La imagen del marco debe estar en formato PNG o WebP.");
  }
  if (
    !Number.isSafeInteger(image.size)
    || image.size < 1
    || image.size > MAX_VIRTUAL_TRY_ON_IMAGE_BYTES
  ) {
    fail("La imagen del marco debe pesar entre 1 byte y 5 MiB.");
  }

  return {
    image: {
      file: image,
      filename: normalizedFilename(image.name),
      mediaType: image.type,
      size: image.size,
    },
    notes: optionalText(formData.get("notes"), "Las notas", 500),
    rotationOffsetDegrees: decimal(
      formData.get("rotationOffsetDegrees"),
      "La corrección de rotación",
      -30,
      30,
      0,
    ),
    verticalOffset: decimal(
      formData.get("verticalOffset"),
      "El desplazamiento vertical",
      -1,
      1,
      0,
    ),
    widthScale: decimal(
      formData.get("widthScale"),
      "La escala del ancho",
      1.2,
      4,
      2.2,
    ),
  };
}

export function validateVirtualTryOnImageBytes(data, mediaType) {
  if (!Buffer.isBuffer(data) || data.length < 12) {
    fail("El archivo del marco está vacío o incompleto.");
  }

  const isPng = mediaType === "image/png"
    && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = mediaType === "image/webp"
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP";

  if (!isPng && !isWebp) {
    fail("El contenido del archivo no corresponde al formato declarado.");
  }
  return data;
}
