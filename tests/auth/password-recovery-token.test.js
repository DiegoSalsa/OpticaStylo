import assert from "node:assert/strict";
import test from "node:test";

import {
  createPasswordRecoveryRequestId,
  createPasswordRecoveryUrl,
  derivePasswordRecoveryToken,
  getPasswordRecoveryConfiguration,
  hashPasswordRecoveryToken,
  PASSWORD_RECOVERY_SCOPES,
} from "../../src/auth/password-recovery-token.js";

const requestId = "00000000-0000-4000-8000-000000000041";
const tokenSecret = Buffer.alloc(32, 9);

test("genera identificadores criptográficos independientes", () => {
  const first = createPasswordRecoveryRequestId();
  const second = createPasswordRecoveryRequestId();
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.match(second, /^[0-9a-f-]{36}$/);
});

test("deriva tokens distintos por ámbito y almacena un hash estable", () => {
  const internalToken = derivePasswordRecoveryToken({
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    tokenSecret,
  });
  const storeToken = derivePasswordRecoveryToken({
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
    tokenSecret,
  });
  assert.match(internalToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(internalToken, storeToken);
  assert.equal(
    internalToken,
    derivePasswordRecoveryToken({
      requestId,
      scope: PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
      tokenSecret,
    }),
  );
  const tokenHash = hashPasswordRecoveryToken(internalToken);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(tokenHash, internalToken);
});

test("construye rutas distintas sin aceptar orígenes inseguros en producción", () => {
  const token = derivePasswordRecoveryToken({
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    tokenSecret,
  });
  const internalUrl = new URL(createPasswordRecoveryUrl({
    appOrigin: "https://example.test",
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    token,
  }));
  const storeUrl = new URL(createPasswordRecoveryUrl({
    appOrigin: "https://example.test",
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
    token,
  }));
  assert.equal(internalUrl.pathname, "/ingresar");
  assert.equal(storeUrl.pathname, "/cuenta");
  assert.equal(internalUrl.searchParams.get("recoveryRequest"), requestId);
  assert.ok(internalUrl.searchParams.has("recoveryToken"));
  assert.throws(
    () => getPasswordRecoveryConfiguration({
      NODE_ENV: "production",
      PASSWORD_RESET_APP_ORIGIN: "http://example.test",
      PASSWORD_RESET_TOKEN_SECRET: "s".repeat(32),
    }),
    /HTTPS/,
  );
});

test("rechaza claves de derivación demasiado cortas", () => {
  assert.throws(
    () => getPasswordRecoveryConfiguration({
      NODE_ENV: "test",
      PASSWORD_RESET_APP_ORIGIN: "https://example.test",
      PASSWORD_RESET_TOKEN_SECRET: "corta",
    }),
    /clave de recuperación/,
  );
});
