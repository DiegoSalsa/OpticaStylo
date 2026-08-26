import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function source(path) {
  return readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

test("la galería no fuerza la cámara y ambas fuentes inician la lectura", async () => {
  const [cart, imageInput] = await Promise.all([
    source("../../src/app/carrito/cart-experience.js"),
    source("../../src/app/carrito/prescription-image-input.js"),
  ]);

  assert.doesNotMatch(imageInput, /capture=/);
  assert.match(imageInput, /await onImageChange\(capturedImage\)/);
  assert.match(imageInput, /void onImageChange\(file\)/);
  assert.match(cart, /async function handlePrescriptionImageChange\(image\)/);
  assert.match(cart, /await uploadAndReadPrescriptionImage\(image\)/);
  assert.match(cart, /onImageChange=\{handlePrescriptionImageChange\}/);
});
