import assert from "node:assert/strict";
import test from "node:test";

import { getHealthStatus } from "../../src/services/health-service.js";

test("el health comprueba PostgreSQL mediante su repository Prisma", async () => {
  let checks = 0;
  const result = await getHealthStatus({
    checkDatabaseConnection: async () => {
      checks += 1;
    },
  });

  assert.equal(checks, 1);
  assert.deepEqual(result, {
    database: "ok",
    service: "optica-stylo",
    status: "ok",
  });
});
