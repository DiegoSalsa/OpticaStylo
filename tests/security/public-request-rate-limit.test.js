import assert from "node:assert/strict";
import test from "node:test";

import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "../../src/security/public-request-rate-limit.js";

function dependencies(attemptsByBucket = new Map()) {
  return {
    getMetadata: () => ({ ipAddress: "203.0.113.15" }),
    now: () => new Date("2026-08-22T12:00:00.000Z"),
    reserveQuota: async ({ bucket }) => {
      const attempts = (attemptsByBucket.get(bucket) ?? 0) + 1;
      attemptsByBucket.set(bucket, attempts);
      return { attempts, expiresAt: new Date("2026-08-22T12:15:00.000Z") };
    },
  };
}

test("limita el inicio de sesión antes de llegar al servicio costoso", async () => {
  const deps = dependencies();
  const request = new Request("https://example.com/api/auth/login", { method: "POST" });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_LOGIN,
      "admin@example.com",
      deps,
    );
  }
  await assert.rejects(
    () => enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_LOGIN,
      "admin@example.com",
      deps,
    ),
    (error) => error.code === "PUBLIC_REQUEST_RATE_LIMITED"
      && error.status === 429
      && error.headers?.["Retry-After"] === "900",
  );
});

test("mantiene cuotas separadas para identidades distintas", async () => {
  const deps = dependencies();
  const request = new Request("https://example.com/api/store/booking", { method: "POST" });
  await enforcePublicRequestRateLimit(
    request,
    PUBLIC_REQUEST_LIMIT_OPERATIONS.PUBLIC_BOOKING,
    "12345678-5",
    deps,
  );
  await enforcePublicRequestRateLimit(
    request,
    PUBLIC_REQUEST_LIMIT_OPERATIONS.PUBLIC_BOOKING,
    "87654321-4",
    deps,
  );
});
