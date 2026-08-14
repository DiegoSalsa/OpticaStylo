import assert from "node:assert/strict";
import test from "node:test";

import {
  validateVirtualTryOnImageBytes,
  validateVirtualTryOnUpload,
} from "../../src/validations/virtual-try-on-validation.js";

function form(values) {
  return { get: (key) => values[key] ?? null };
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const image = {
  arrayBuffer: async () => png,
  name: "marco.png",
  size: png.length,
  type: "image/png",
};

test("normaliza una imagen y su calibración", () => {
  const result = validateVirtualTryOnUpload(form({
    image,
    notes: "  Ajuste inicial  ",
    rotationOffsetDegrees: "1.5",
    verticalOffset: "-0.12",
    widthScale: "2.35",
  }));
  assert.equal(result.image.filename, "marco.png");
  assert.equal(result.notes, "Ajuste inicial");
  assert.equal(result.rotationOffsetDegrees, 1.5);
  assert.equal(result.verticalOffset, -0.12);
  assert.equal(result.widthScale, 2.35);
});

test("rechaza archivos que solo simulan ser una imagen", () => {
  assert.throws(
    () => validateVirtualTryOnImageBytes(Buffer.from("no-es-png!!"), "image/png"),
    (error) => error.code === "INVALID_VIRTUAL_TRY_ON_DATA",
  );
});

test("acepta las firmas binarias declaradas", () => {
  assert.equal(validateVirtualTryOnImageBytes(png, "image/png"), png);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");
  assert.equal(validateVirtualTryOnImageBytes(webp, "image/webp"), webp);
});

test("limita los parámetros de calibración", () => {
  assert.throws(
    () => validateVirtualTryOnUpload(form({ image, widthScale: "7" })),
    (error) => error.code === "INVALID_VIRTUAL_TRY_ON_DATA",
  );
});
