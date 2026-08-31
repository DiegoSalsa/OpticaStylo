import assert from "node:assert/strict";
import test from "node:test";

import { canUseStoreTestData } from "../../src/utils/store-test-data.js";

test("habilita datos de prueba fuera de producción", () => {
  assert.equal(canUseStoreTestData({ NODE_ENV: "development" }), true);
});

test("requiere habilitación explícita para datos de prueba en producción", () => {
  assert.equal(canUseStoreTestData({ NODE_ENV: "production" }), false);
  assert.equal(canUseStoreTestData({
    NODE_ENV: "production",
    DEPLOYMENT_ENVIRONMENT: "university",
    STORE_INCLUDE_TEST_DATA: "true",
  }), true);
  assert.equal(canUseStoreTestData({
    NODE_ENV: "production",
    DEPLOYMENT_ENVIRONMENT: "vercel",
    STORE_INCLUDE_TEST_DATA: "true",
  }), false);
});
