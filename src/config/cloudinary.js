import { AppError } from "../utils/app-error.js";

const CLOUD_NAME_PATTERN = /^[a-z0-9_-]{2,128}$/i;
const API_KEY_PATTERN = /^\d{6,32}$/;

function required(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getCloudinaryConfig(environment = process.env) {
  const cloudName = required(environment.CLOUDINARY_CLOUD_NAME);
  const apiKey = required(environment.CLOUDINARY_API_KEY);
  const apiSecret = required(environment.CLOUDINARY_API_SECRET);

  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError({
      code: "CLOUDINARY_NOT_CONFIGURED",
      message: "El almacenamiento de archivos no está configurado.",
      status: 503,
    });
  }
  if (!CLOUD_NAME_PATTERN.test(cloudName) || !API_KEY_PATTERN.test(apiKey) || apiSecret.length < 16) {
    throw new AppError({
      code: "CLOUDINARY_INVALID_CONFIG",
      message: "La configuración del almacenamiento de archivos no es válida.",
      status: 503,
    });
  }

  return Object.freeze({ apiKey, apiSecret, cloudName });
}
