import { AppError } from "../utils/app-error.js";

export const OPENAI_PRESCRIPTION_READER_MODEL = "gpt-5.6-luna";

const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,}$/;

function value(environment, key) {
  return typeof environment[key] === "string" ? environment[key].trim() : "";
}

export function getOpenAiPrescriptionReaderConfig(environment = process.env) {
  const enabled = value(environment, "OPENAI_PRESCRIPTION_READER_ENABLED") === "true";
  const apiKey = value(environment, "OPENAI_API_KEY");

  if (!enabled) {
    throw new AppError({
      code: "PRESCRIPTION_READER_NOT_CONFIGURED",
      message: "La lectura automática de recetas no está habilitada.",
      status: 503,
    });
  }
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new AppError({
      code: "PRESCRIPTION_READER_NOT_CONFIGURED",
      message: "La lectura automática de recetas no está configurada correctamente.",
      status: 503,
    });
  }

  return Object.freeze({
    apiKey,
    maxOutputTokens: 400,
    model: OPENAI_PRESCRIPTION_READER_MODEL,
    timeoutMilliseconds: 20_000,
  });
}
