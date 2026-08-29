import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const source = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");

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

test("separa y limita solicitudes e intentos de recuperación", async () => {
  const deps = dependencies();
  const request = new Request("https://example.com/api/auth/password-recovery", { method: "POST" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_PASSWORD_RECOVERY_REQUEST,
      "persona@example.test",
      deps,
    );
  }
  await assert.rejects(
    () => enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_PASSWORD_RECOVERY_REQUEST,
      "persona@example.test",
      deps,
    ),
    (error) => error.code === "PUBLIC_REQUEST_RATE_LIMITED",
  );
  await enforcePublicRequestRateLimit(
    request,
    PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_PASSWORD_RESET,
    "00000000-0000-4000-8000-000000000022",
    deps,
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

test("limita la creacion anonima de carritos antes de persistirlos", async () => {
  const deps = dependencies();
  const request = new Request("https://example.com/api/store/cart", { method: "POST" });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_CART_CREATION,
      null,
      deps,
    );
  }
  await assert.rejects(
    () => enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_CART_CREATION,
      null,
      deps,
    ),
    (error) => error.code === "PUBLIC_REQUEST_RATE_LIMITED" && error.status === 429,
  );
});

test("limita la carga de recetas antes de enviarlas a Cloudinary", async () => {
  const deps = dependencies();
  const request = new Request("https://example.com/api/store/cart/prescription/image", { method: "PUT" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_UPLOAD,
      "carrito-de-prueba",
      deps,
    );
  }
  await assert.rejects(
    () => enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_UPLOAD,
      "carrito-de-prueba",
      deps,
    ),
    (error) => error.code === "PUBLIC_REQUEST_RATE_LIMITED" && error.status === 429,
  );
});

test("aplica las cuotas antes de crear recursos o leer archivos multipart", async () => {
  const [cart, image] = await Promise.all([
    source("app/api/store/cart/route.js"),
    source("app/api/store/cart/prescription/image/route.js"),
  ]);

  assert.match(cart, /enforcePublicRequestRateLimit\([\s\S]*createStoreCart\(/);
  assert.match(image, /enforcePublicRequestRateLimit\([\s\S]*readMultipartFormData\(/);
});

test("limita las lecturas automáticas de recetas antes de consumir saldo", async () => {
  const deps = dependencies();
  const request = new Request("https://example.com/api/store/cart/prescription/extract", { method: "POST" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_EXTRACTION,
      "carrito-de-prueba",
      deps,
    );
  }
  await assert.rejects(
    () => enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_EXTRACTION,
      "carrito-de-prueba",
      deps,
    ),
    (error) => error.code === "PUBLIC_REQUEST_RATE_LIMITED" && error.status === 429,
  );
});
