import assert from "node:assert/strict";
import test from "node:test";
import { readStoreCatalogQuery, storeCatalogParams } from "../../src/utils/store-catalog-query.js";
import { validateStoreCatalogQuery } from "../../src/validations/store-catalog-validation.js";

test("la URL conserva todos los filtros, búsqueda y página sin duplicar valores por defecto", () => {
  const params = new URLSearchParams("search=Ray-Ban&category=FRAME&prescription=optional&availability=available&sort=newest&page=3");
  const filters = readStoreCatalogQuery(params);
  assert.equal(storeCatalogParams(filters).toString(), "category=FRAME&search=Ray-Ban&prescription=optional&availability=available&sort=newest&page=3");
  assert.equal(storeCatalogParams(readStoreCatalogQuery(new URLSearchParams())).size, 0);
  assert.equal(readStoreCatalogQuery(new URLSearchParams("page=-1&category=INVALID&sort=INVALID")).page, 1);
});

test("el servidor rechaza filtros desconocidos y aplica orden y receta antes de paginar", () => {
  const filters = validateStoreCatalogQuery(new URLSearchParams("page=2&pageSize=24&sort=price-desc&prescription=optional"));
  assert.equal(filters.sort, "price-desc");
  assert.equal(filters.prescription, "optional");
  assert.equal(filters.page, 2);
  for (const query of ["sort=invalid", "prescription=invalid", "availability=invalid", "page=0"]) {
    assert.throws(() => validateStoreCatalogQuery(new URLSearchParams(query)), (error) => error.status === 400);
  }
});
