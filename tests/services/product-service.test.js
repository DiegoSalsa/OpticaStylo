import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import { createProduct, updateProduct } from "../../src/services/product-service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const input = { category: "FRAME", name: "Marco", requiresPrescription: false, sku: "M-1", unitPriceCents: 30000 };

test("solo administración puede crear productos", async () => {
  await assert.rejects(() => createProduct(input, { permissions: [], userId }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS");
});

test("crea un producto activo", async () => {
  const result = await createProduct(input, { permissions: [PERMISSIONS.PRODUCTS_MANAGE], userId }, {
    createProduct: async (data, actorId) => ({ ...data, actorId, id: productId }),
  });
  assert.equal(result.id, productId);
  assert.equal(result.actorId, userId);
});

test("registra qué campos del producto cambiaron", async () => {
  const current = { ...input, id: productId, isActive: true };
  await updateProduct(productId, { unitPriceCents: 35000 },
    { permissions: [PERMISSIONS.PRODUCTS_MANAGE], userId }, {
      findProductById: async () => current,
      updateProduct: async (id, data, changedFields) => {
        assert.deepEqual(changedFields, ["unitPriceCents"]);
        return { ...data, id };
      },
    });
});
