import assert from "node:assert/strict";
import test from "node:test";

import { getRequestMetadata } from "../../src/utils/request-metadata.js";

test("usa la dirección de Vercel solo dentro de ese intermediario confiable", () => {
  const request = new Request("https://opticastylo.example", {
    headers: { "x-vercel-forwarded-for": "203.0.113.15, 198.51.100.1" },
  });
  assert.equal(getRequestMetadata(request, { VERCEL: "1" }).ipAddress, "203.0.113.15");
  assert.equal(getRequestMetadata(request, {}).ipAddress, null);
});

test("usa la cabecera estándar de Vercel si no está disponible su alias", () => {
  const request = new Request("https://opticastylo.example", {
    headers: { "x-forwarded-for": "203.0.113.20" },
  });
  assert.equal(getRequestMetadata(request, { VERCEL: "1" }).ipAddress, "203.0.113.20");
});

test("acepta x-forwarded-for solo con proxy declarado", () => {
  const request = new Request("https://opticastylo.example", {
    headers: { "x-forwarded-for": "2001:db8::5" },
  });
  assert.equal(getRequestMetadata(request, { TRUST_PROXY: "true" }).ipAddress, "2001:db8::5");
});
