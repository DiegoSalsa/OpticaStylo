import assert from "node:assert/strict";
import test from "node:test";

import {
  getStoreProduct,
  getStoreProducts,
} from "../../src/services/store-catalog-service.js";

const product = {
  category: "ACCESSORY",
  id: "00000000-0000-4000-8000-000000000001",
  isActive: true,
  name: "Estuche",
  requiresPrescription: false,
  sku: "ACC-1",
  unitPriceCents: 5000,
};

test("fuerza el catálogo público a mostrar solo activos", async () => {
  const query = new URLSearchParams("isActive=false");
  const result = await getStoreProducts(query, {
    listProducts: async (filters) => {
      assert.equal(filters.isActive, true);
      return { items: [product], page: 1, pageSize: 20, total: 1, totalPages: 1 };
    },
  });
  assert.equal(result.items[0].availability.source, "MOCK");
});

test("oculta productos inactivos por identificador", async () => {
  await assert.rejects(() => getStoreProduct(product.id, {
    findProductById: async () => ({ ...product, isActive: false }),
  }), (error) => error.code === "STORE_PRODUCT_NOT_FOUND" && error.status === 404);
});
