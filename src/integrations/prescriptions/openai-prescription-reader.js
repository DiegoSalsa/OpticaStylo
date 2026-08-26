import { createHash } from "node:crypto";

import { getOpenAiPrescriptionReaderConfig } from "../../config/openai.js";
import { AppError } from "../../utils/app-error.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ACCEPTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const PRESCRIPTION_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    confidence: { enum: ["LOW", "MEDIUM", "HIGH"], type: "string" },
    fulfillmentNotes: { type: ["string", "null"] },
    leftEye: {
      additionalProperties: false,
      properties: {
        addition: { type: ["number", "null"] },
        axis: { type: ["integer", "null"] },
        cylinder: { type: ["number", "null"] },
        sphere: { type: ["number", "null"] },
      },
      required: ["sphere", "cylinder", "axis", "addition"],
      type: "object",
    },
    pupillaryDistance: { type: ["number", "null"] },
    rightEye: {
      additionalProperties: false,
      properties: {
        addition: { type: ["number", "null"] },
        axis: { type: ["integer", "null"] },
        cylinder: { type: ["number", "null"] },
        sphere: { type: ["number", "null"] },
      },
      required: ["sphere", "cylinder", "axis", "addition"],
      type: "object",
    },
    warnings: { items: { type: "string" }, type: "array" },
  },
  required: [
    "rightEye",
    "leftEye",
    "pupillaryDistance",
    "fulfillmentNotes",
    "confidence",
    "warnings",
  ],
  type: "object",
});

function unavailable() {
  return new AppError({
    code: "PRESCRIPTION_READER_UNAVAILABLE",
    message: "No fue posible leer la receta automáticamente. Puede completar los valores manualmente.",
    status: 503,
  });
}

function invalidResult() {
  return new AppError({
    code: "PRESCRIPTION_READER_INVALID_RESULT",
    message: "La lectura automática no entregó un borrador utilizable. Puede completar los valores manualmente.",
    status: 422,
  });
}

function numberOrNull(value) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= 10_000) {
    throw invalidResult();
  }
  return Object.is(value, -0) ? 0 : value;
}

function axisOrNull(value) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 180) throw invalidResult();
  return value;
}

function eye(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResult();
  return {
    addition: numberOrNull(value.addition),
    axis: axisOrNull(value.axis),
    cylinder: numberOrNull(value.cylinder),
    sphere: numberOrNull(value.sphere),
  };
}

function nullableText(value, maximumLength) {
  if (value === null) return null;
  if (typeof value !== "string") throw invalidResult();
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function normalizeDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResult();
  if (!new Set(["LOW", "MEDIUM", "HIGH"]).has(value.confidence)) throw invalidResult();
  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) {
    throw invalidResult();
  }
  return {
    confidence: value.confidence,
    fulfillmentNotes: nullableText(value.fulfillmentNotes, 1000),
    leftEye: eye(value.leftEye),
    pupillaryDistance: numberOrNull(value.pupillaryDistance),
    rightEye: eye(value.rightEye),
    warnings: value.warnings
      .map((warning) => warning.trim().replace(/\s+/g, " ").slice(0, 300))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function requestBody(image, configuration) {
  const dataUrl = `data:${image.mediaType};base64,${image.data.toString("base64")}`;
  const safetyIdentifier = createHash("sha256")
    .update(image.data)
    .digest("hex")
    .slice(0, 64);
  return {
    input: [{
      content: [
        {
          text: "Lee esta receta óptica. Transcribe solo valores explícitos. Si un valor no se distingue o no aparece, usa null. No inventes valores, no diagnostiques y no des por aprobada la receta. Indica advertencias breves cuando la imagen sea ilegible, ambigua o incompleta.",
          type: "input_text",
        },
        { detail: "high", image_url: dataUrl, type: "input_image" },
      ],
      role: "user",
    }],
    max_output_tokens: configuration.maxOutputTokens,
    model: configuration.model,
    reasoning: { effort: "none" },
    safety_identifier: safetyIdentifier,
    store: false,
    text: {
      format: {
        name: "borrador_receta_optica",
        schema: PRESCRIPTION_SCHEMA,
        strict: true,
        type: "json_schema",
      },
    },
  };
}

function outputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  if (!Array.isArray(response?.output)) return null;
  const texts = response.output.flatMap((item) => (
    Array.isArray(item?.content)
      ? item.content
        .filter((content) => content?.type === "output_text" && typeof content.text === "string")
        .map((content) => content.text)
      : []
  ));
  return texts.length === 1 ? texts[0] : null;
}

function extractOutput(response) {
  const text = outputText(response);
  if (!response || response.status !== "completed" || typeof text !== "string") {
    throw invalidResult();
  }
  try {
    return normalizeDraft(JSON.parse(text));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidResult();
  }
}

export async function readOpenAiPrescriptionImage(
  image,
  { environment = process.env, fetchImplementation = fetch } = {},
) {
  if (!image?.data || !ACCEPTED_MEDIA_TYPES.has(image.mediaType)) {
    throw new AppError({
      code: "PRESCRIPTION_READER_UNSUPPORTED_IMAGE",
      message: "La lectura automática admite imágenes JPEG, PNG o WEBP. Puede completar esta receta manualmente.",
      status: 422,
    });
  }
  const configuration = getOpenAiPrescriptionReaderConfig(environment);
  let response;
  try {
    response = await fetchImplementation(OPENAI_RESPONSES_URL, {
      body: JSON.stringify(requestBody(image, configuration)),
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(configuration.timeoutMilliseconds),
    });
  } catch (error) {
    console.error("No fue posible contactar el lector automático de recetas.", error);
    throw unavailable();
  }
  if (!response.ok) {
    console.error("El lector automático de recetas rechazó la solicitud.", response.status);
    throw unavailable();
  }
  try {
    return {
      data: extractOutput(await response.json()),
      provider: "OPENAI_GPT_5_6_LUNA",
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("El lector automático de recetas devolvió una respuesta inválida.", error);
    throw unavailable();
  }
}
