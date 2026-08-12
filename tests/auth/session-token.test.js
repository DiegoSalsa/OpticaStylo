import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  hashSessionToken,
} from "../../src/auth/session-token.js";

test("genera tokens de sesión aleatorios", () => {
  const firstToken = createSessionToken();
  const secondToken = createSessionToken();

  assert.notEqual(firstToken, secondToken);
  assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/);
});

test("genera hashes SHA-256 estables sin exponer el token", () => {
  const token = "token-de-prueba";
  const tokenHash = hashSessionToken(token);

  assert.equal(tokenHash, hashSessionToken(token));
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.ok(!tokenHash.includes(token));
});
