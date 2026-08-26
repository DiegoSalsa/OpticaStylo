import assert from "node:assert/strict";
import test from "node:test";

import { validateProductImageBytes } from "../../src/validations/product-image-validation.js";

function pngHeader(width, height) {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

test("acepta una imagen de producto dentro del limite de pixeles", () => {
  const image = pngHeader(4000, 6000);
  assert.equal(validateProductImageBytes(image, "image/png"), image);
});

test("rechaza una imagen de producto con demasiados pixeles", () => {
  assert.throws(
    () => validateProductImageBytes(pngHeader(8000, 8000), "image/png"),
    (error) => error.code === "INVALID_PRODUCT_IMAGE" && error.status === 400,
  );
});
