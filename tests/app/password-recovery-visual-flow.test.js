import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recoveryFormSource = readFileSync(new URL(
  "../../src/components/auth/password-recovery-form.js",
  import.meta.url,
), "utf8");
const internalLoginSource = readFileSync(new URL(
  "../../src/app/ingresar/login-experience.js",
  import.meta.url,
), "utf8");
const storeAccountSource = readFileSync(new URL(
  "../../src/app/cuenta/account-experience.js",
  import.meta.url,
), "utf8");

test("conecta la recuperación visual a los ámbitos separados", () => {
  assert.match(internalLoginSource, /endpointBase="\/api\/auth"/);
  assert.match(storeAccountSource, /endpointBase="\/api\/store\/accounts"/);
  assert.match(recoveryFormSource, /\$\{endpointBase\}\/password-recovery/);
  assert.match(recoveryFormSource, /\$\{endpointBase\}\/password-reset/);
});

test("mantiene las referencias fuera de la interfaz y limpia la dirección", () => {
  assert.match(recoveryFormSource, /window\.history\.replaceState\(null, "", window\.location\.pathname\)/);
  assert.doesNotMatch(recoveryFormSource, />\s*\{recoveryToken\}\s*</);
  assert.doesNotMatch(recoveryFormSource, />\s*\{recoveryRequest\}\s*</);
});

test("incluye estados accesibles y la política vigente de contraseña", () => {
  assert.match(recoveryFormSource, /role="status"/);
  assert.match(recoveryFormSource, /role="alert"/);
  assert.match(recoveryFormSource, /aria-live="polite"/);
  assert.match(recoveryFormSource, /minLength=\{15\}/);
  assert.match(recoveryFormSource, /maxLength=\{128\}/);
  assert.match(recoveryFormSource, /autoComplete="new-password"/);
});
