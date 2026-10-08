import assert from "node:assert/strict";
import test from "node:test";
import { availableBundledTryOnModels } from "../../src/services/bundled-try-on-models.js";

test("los dos modelos aprobados tienen archivos publicados y hashes válidos", async () => {
  assert.deepEqual((await availableBundledTryOnModels()).map((model) => model.sku).sort(), ["HD0896-001", "RB2140-901-50"]);
});
test("un archivo ausente nunca se ofrece como prueba virtual", async () => {
  assert.deepEqual(await availableBundledTryOnModels({ read: async () => { throw new Error("ENOENT"); } }), []);
});
test("un GLB que no coincide con los metadatos publicados nunca se ofrece", async () => {
  const { readFile } = await import("node:fs/promises");
  assert.deepEqual(await availableBundledTryOnModels({ read: async (path, encoding) => encoding ? readFile(path, encoding) : Buffer.from("glTFarchivo-corrupto") }), []);
});
