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
      assert.equal(filters.excludeCategory, "PRESCRIPTION_LENS");
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

test("oculta los datos de prueba fuera del entorno local", async () => {
  const result = await getStoreProducts(new URLSearchParams(), {
    includeTestData: false,
    listProducts: async (filters) => {
      assert.equal(filters.includeTestData, false);
      return {
        items: [product],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      };
    },
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.total, 1);
});

test("oculta un producto de prueba por identificador fuera del entorno local", async () => {
  await assert.rejects(() => getStoreProduct(product.id, {
    findProductById: async () => ({ ...product, isTestData: true }),
    includeTestData: false,
  }), (error) => error.code === "STORE_PRODUCT_NOT_FOUND" && error.status === 404);
});

test("oculta los cristales como productos independientes en la tienda", async () => {
  await assert.rejects(() => getStoreProduct(product.id, {
    findProductById: async () => ({ ...product, category: "PRESCRIPTION_LENS" }),
  }), (error) => error.code === "STORE_PRODUCT_NOT_FOUND" && error.status === 404);
});

test("incluye la galería y ficha del modelo HD0896-001", async () => {
  const result = await getStoreProduct(product.id, {
    findProductById: async () => ({ ...product, category: "FRAME", sku: "HD0896-001" }),
    listProducts: async (filters) => {
      assert.equal(filters.category, "PRESCRIPTION_LENS");
      return {
        items: [{ ...product, category: "PRESCRIPTION_LENS", isTestData: true }],
      };
    },
  });
  assert.equal(result.images.length, 3);
  assert.equal(result.specifications.find((item) => item.label === "Medidas")?.value, "56-15-145 mm");
  assert.equal(result.lensOptions[0].isTestData, true);
  assert.match(result.description, /Harley-Davidson/);
});
