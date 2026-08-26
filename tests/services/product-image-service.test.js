import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import { addProductImage, removeProductImage } from "../../src/services/product-image-service.js";

const productId = "00000000-0000-4000-8000-000000000002";
const imageId = "00000000-0000-4000-8000-000000000003";
const actor = { permissions: [PERMISSIONS.PRODUCTS_MANAGE], userId: "00000000-0000-4000-8000-000000000004" };

function imageFile() {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(1, 16);
  data.writeUInt32BE(1, 20);
  const file = new Blob([data], { type: "image/png" });
  Object.defineProperty(file, "name", { value: "marco.png" });
  return file;
}

test("guarda una imagen de producto en Cloudinary y registra su referencia", async () => {
  const result = await addProductImage(productId, { alt: "Vista frontal", file: imageFile() }, actor, {
    createImage: async (_productId, data) => {
      assert.equal(data.publicId, "opticastylo/productos/uno");
      return { image: { id: imageId, ...data }, reason: null };
    },
    findProductById: async () => ({ id: productId }),
    mediaGateway: {
      deletePublicProductImage: async () => assert.fail("No debe compensar una carga exitosa"),
      uploadPublicProductImage: async () => ({
        assetId: "asset-uno",
        format: "png",
        height: 10,
        publicId: "opticastylo/productos/uno",
        secureUrl: "https://res.cloudinary.com/demo/image/upload/uno.png",
        version: 1,
        width: 10,
      }),
    },
  });
  assert.equal(result.id, imageId);
});

test("retira la referencia de catálogo y solicita borrar el archivo público", async () => {
  let deleted = false;
  const result = await removeProductImage(productId, imageId, actor, {
    findImage: async () => ({ assetId: "asset-uno", publicId: "opticastylo/productos/uno" }),
    mediaGateway: {
      deletePublicProductImage: async (asset) => {
        deleted = asset.publicId === "opticastylo/productos/uno";
        return true;
      },
    },
    retireImage: async () => ({ id: imageId, status: "RETIRED" }),
  });
  assert.equal(result.status, "RETIRED");
  assert.equal(deleted, true);
});
