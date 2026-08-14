import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  deactivateVirtualTryOnAsset,
  getPublicVirtualTryOnAssetFile,
  uploadVirtualTryOnAsset,
} from "../../src/services/virtual-try-on-service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";
const actor = { permissions: [PERMISSIONS.PRODUCTS_MANAGE], userId };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function uploadForm() {
  const values = {
    image: {
      arrayBuffer: async () => png,
      name: "marco.png",
      size: png.length,
      type: "image/png",
    },
  };
  return { get: (key) => values[key] ?? null };
}

test("versiona un recurso válido para un producto tipo marco", async () => {
  const result = await uploadVirtualTryOnAsset(productId, uploadForm(), actor, {
    findProductById: async () => ({ category: "FRAME", id: productId }),
    replaceActiveAsset: async (id, asset, actorId) => {
      assert.equal(id, productId);
      assert.equal(actorId, userId);
      assert.deepEqual(asset.data, png);
      assert.match(asset.sha256, /^[0-9a-f]{64}$/);
      return { assetId, productId: id, version: 1 };
    },
  });
  assert.equal(result.assetId, assetId);
});

test("impide configurar prueba virtual en productos que no son marcos", async () => {
  await assert.rejects(
    () => uploadVirtualTryOnAsset(productId, uploadForm(), actor, {
      findProductById: async () => ({ category: "ACCESSORY", id: productId }),
    }),
    (error) => error.code === "VIRTUAL_TRY_ON_REQUIRES_FRAME" && error.status === 409,
  );
});

test("conserva el historial al retirar el recurso activo", async () => {
  const result = await deactivateVirtualTryOnAsset(productId, actor, {
    findProductById: async () => ({ category: "FRAME", id: productId }),
    retireActiveAsset: async (id, actorId) => ({ assetId, actorId, productId: id, status: "RETIRED" }),
  });
  assert.equal(result.status, "RETIRED");
  assert.equal(result.actorId, userId);
});

test("oculta archivos retirados o inexistentes del endpoint público", async () => {
  await assert.rejects(
    () => getPublicVirtualTryOnAssetFile(assetId, { findPublicAssetFile: async () => null }),
    (error) => error.code === "VIRTUAL_TRY_ON_ASSET_NOT_FOUND" && error.status === 404,
  );
});
