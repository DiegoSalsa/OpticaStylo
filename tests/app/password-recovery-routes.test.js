import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = (path) => readFile(new URL(`../../src/app/api/${path}`, import.meta.url), "utf8");

test("las cuatro rutas validan cuerpo, aplican cuota y no devuelven secretos", async () => {
  const sources = await Promise.all([
    route("auth/password-recovery/route.js"),
    route("auth/password-reset/route.js"),
    route("store/accounts/password-recovery/route.js"),
    route("store/accounts/password-reset/route.js"),
  ]);
  for (const source of sources) {
    assert.match(source, /readJsonBody\(request\)/);
    assert.match(source, /enforcePublicRequestRateLimit\(/);
    assert.doesNotMatch(source, /recoveryToken.*createSuccessResponse/s);
  }
  assert.match(sources[0], /INTERNAL_PASSWORD_RECOVERY_REQUEST/);
  assert.match(sources[1], /INTERNAL_PASSWORD_RESET/);
  assert.match(sources[2], /STORE_PASSWORD_RECOVERY_REQUEST/);
  assert.match(sources[3], /STORE_PASSWORD_RESET/);
});
