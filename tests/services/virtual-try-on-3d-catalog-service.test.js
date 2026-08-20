import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublic3dModelFile,
  getPublic3dModelMetadata,
  getPublic3dModels,
} from "../../src/services/virtual-try-on-3d-catalog-service.js";

const assetId = "00000000-0000-4000-8000-000000000001";

test("publica solamente la proyección segura del catálogo 3D", async () => {
  const models = [{ assetId, licenseCode: "CC0-1.0", modelUrl: `/models/${assetId}` }];
  assert.equal(await getPublic3dModels({ listModels: async () => models }), models);
});

test("valida el identificador antes de consultar archivos 3D", async () => {
  await assert.rejects(
    () => getPublic3dModelFile("incorrecto", { findFile: async () => ({}) }),
    (error) => error.code === "INVALID_3D_ASSET_ID" && error.status === 400,
  );
});

test("oculta modelos retirados o inexistentes", async () => {
  await assert.rejects(
    () => getPublic3dModelMetadata(assetId, { findMetadata: async () => null }),
    (error) => error.code === "VIRTUAL_TRY_ON_3D_MODEL_NOT_FOUND" && error.status === 404,
  );
});
