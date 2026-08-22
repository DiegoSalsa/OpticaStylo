import assert from "node:assert/strict";
import test from "node:test";

import {
  isKnownMediaPipeConsoleNotice,
  withMediaPipeConsoleFilter,
} from "../../src/utils/mediapipe-console.js";

test("reconoce solamente el aviso informativo de XNNPACK", () => {
  assert.equal(isKnownMediaPipeConsoleNotice([
    "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.",
  ]), true);
  assert.equal(isKnownMediaPipeConsoleNotice([
    "MediaPipe no pudo crear el detector",
  ]), false);
});

test("silencia el aviso de XNNPACK y conserva los errores reales", async () => {
  const originalConsoleError = console.error;
  const forwarded = [];
  console.error = (...argumentsList) => forwarded.push(argumentsList);

  try {
    await withMediaPipeConsoleFilter(async () => {
      console.error("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
      console.error("Error real", { code: "tracker_failed" });
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(forwarded, [["Error real", { code: "tracker_failed" }]]);
});

test("restaura console.error incluso cuando la inicialización falla", async () => {
  const originalConsoleError = console.error;
  await assert.rejects(
    withMediaPipeConsoleFilter(async () => {
      throw new Error("falló la carga");
    }),
    /falló la carga/,
  );
  assert.equal(console.error, originalConsoleError);
});
