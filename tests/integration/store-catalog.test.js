import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/db/prisma.js";
import { getStoreProducts } from "../../src/services/store-catalog-service.js";
import { seedCatalogData } from "../fixtures/catalog-data.js";

test("catálogo PostgreSQL: filtros, orden global y paginación determinista", { skip: !process.env.STORE_E2E_SCHEMA }, async (t) => {
  try {
    await seedCatalogData();
    // Consultar exactamente el catálogo HTTP, sin un repositorio ni stock sustituidos.
    const list = (query = "") => getStoreProducts(new URLSearchParams(`search=CatalogoDemo&pageSize=24&${query}`));
    await t.test("primera, segunda y última página conservan total y no repiten productos", async () => {
      const pages = await Promise.all([1, 2, 3].map((page) => list(`page=${page}`)));
      assert.deepEqual(pages.map((page) => page.items.length), [24, 24, 7]);
      assert.ok(pages.every((page) => page.total === 55 && page.totalPages === 3));
      assert.equal(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size, 55);
    });
    await t.test("menor y mayor precio se ordenan antes del límite de 24", async () => {
      for (const [sort, first, last] of [["price-asc", 1000, 6400], ["price-desc", 6400, 1000]]) {
        assert.equal((await list(`sort=${sort}`)).items[0].unitPriceCents, first);
        assert.equal((await list(`sort=${sort}&page=3`)).items.at(-1).unitPriceCents, last);
      }
    });
    await t.test("novedades usa fecha de creación y un desempate estable", async () => {
      const first = await list("sort=newest");
      assert.equal(first.items[0].sku, "DEMO-CATALOGO-054");
      assert.deepEqual((await list("sort=newest")).items.map((item) => item.id), first.items.map((item) => item.id));
    });
    await t.test("receta opcional identifica marcos y combina categoría y disponibilidad referencial", async () => {
      const frames = await list("prescription=optional&availability=available");
      assert.equal(frames.total, 27);
      assert.ok(frames.items.every((item) => item.supportsPrescription && !item.requiresPrescription && item.availability.source === "MOCK"));
      assert.equal((await list("category=ACCESSORY&prescription=optional")).total, 0);
      assert.equal((await list("prescription=not-required")).total, 28);
    });
  } finally { await prisma.$disconnect(); }
});
