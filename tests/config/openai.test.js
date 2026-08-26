import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpenAiPrescriptionReaderConfig,
  OPENAI_PRESCRIPTION_READER_MODEL,
} from "../../src/config/openai.js";

const enabledEnvironment = {
  OPENAI_API_KEY: "sk-proj-clave-de-prueba-suficientemente-larga",
  OPENAI_PRESCRIPTION_READER_ENABLED: "true",
};

test("configura Luna para lecturas automáticas de recetas", () => {
  const result = getOpenAiPrescriptionReaderConfig(enabledEnvironment);
  assert.equal(result.model, OPENAI_PRESCRIPTION_READER_MODEL);
  assert.equal(result.maxOutputTokens, 400);
});

test("mantiene la lectura automática cerrada sin habilitación explícita", () => {
  assert.throws(
    () => getOpenAiPrescriptionReaderConfig({ OPENAI_API_KEY: enabledEnvironment.OPENAI_API_KEY }),
    (error) => error.code === "PRESCRIPTION_READER_NOT_CONFIGURED" && error.status === 503,
  );
});
