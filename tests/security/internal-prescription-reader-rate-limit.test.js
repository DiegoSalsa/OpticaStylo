import assert from "node:assert/strict";
import test from "node:test";

import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "../../src/security/public-request-rate-limit.js";

function dependencies(attemptsByBucket = new Map()) {
  return {
    getMetadata: () => ({ ipAddress: "203.0.113.15" }),
    now: () => new Date("2026-08-25T12:00:00.000Z"),
    reserveQuota: async ({ bucket }) => {
      const attempts = (attemptsByBucket.get(bucket) ?? 0) + 1;
      attemptsByBucket.set(bucket, attempts);
      return { attempts, expiresAt: new Date("2026-08-25T13:00:00.000Z") };
    },
  };
}

test("limita la lectura interna de recetas por usuario antes de invocar al modelo", async () => {
  const deps = dependencies();
  const request = new Request("https://example.com/api/external-prescriptions/extract", { method: "POST" });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_PRESCRIPTION_EXTRACTION,
      "00000000-0000-4000-8000-000000000003",
      deps,
    );
  }
  await assert.rejects(
    () => enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_PRESCRIPTION_EXTRACTION,
      "00000000-0000-4000-8000-000000000003",
      deps,
    ),
    (error) => error.code === "PUBLIC_REQUEST_RATE_LIMITED" && error.status === 429,
  );
});
