import assert from "node:assert/strict";
import test from "node:test";

import { readIdempotencyKey } from "../../src/utils/idempotency-key.js";

test("acepta una clave de reintento acotada", () => {
  const request = new Request("https://example.test", {
    headers: { "x-idempotency-key": "venta-20260823-0001" },
  });
  assert.equal(readIdempotencyKey(request), "venta-20260823-0001");
});

test("rechaza claves de reintento manipulables", () => {
  const request = new Request("https://example.test", {
    headers: { "x-idempotency-key": "corta" },
  });
  assert.throws(
    () => readIdempotencyKey(request),
    (error) => error.code === "INVALID_IDEMPOTENCY_KEY",
  );
});
