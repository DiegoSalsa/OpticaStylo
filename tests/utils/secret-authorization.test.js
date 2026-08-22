import assert from "node:assert/strict";
import test from "node:test";

import { hasValidBearerSecret } from "../../src/utils/secret-authorization.js";

const secret = "secreto-cron-de-prueba-seguro";

test("autoriza el secreto bearer exacto", () => {
  const request = new Request("https://example.com/api/internal", {
    headers: { Authorization: `Bearer ${secret}` },
  });
  assert.equal(hasValidBearerSecret(request, secret), true);
});

test("rechaza navegador público, secreto incorrecto y configuración corta", () => {
  assert.equal(hasValidBearerSecret(new Request("https://example.com/api/internal"), secret), false);
  assert.equal(hasValidBearerSecret(new Request("https://example.com/api/internal", {
    headers: { Authorization: "Bearer incorrecto" },
  }), secret), false);
  assert.equal(hasValidBearerSecret(new Request("https://example.com/api/internal", {
    headers: { Authorization: "Bearer corto" },
  }), "corto"), false);
});

