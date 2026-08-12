import assert from "node:assert/strict";
import test from "node:test";

import { authenticateRequest } from "../../src/auth/authenticate-request.js";
import {
  hashSessionToken,
  SESSION_COOKIE_NAME,
} from "../../src/auth/session-token.js";

test("autentica una solicitud con una sesión activa", async () => {
  const token = "token-válido";
  const expectedSession = { userId: "usuario-1", permissions: [] };
  const request = new Request("http://localhost/api/users", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}; otra=galleta` },
  });

  const session = await authenticateRequest(request, {
    findActiveSessionByTokenHash: async (tokenHash) => {
      assert.equal(tokenHash, hashSessionToken(token));
      return expectedSession;
    },
  });

  assert.equal(session, expectedSession);
});

test("rechaza solicitudes sin cookie de sesión", async () => {
  const request = new Request("http://localhost/api/users");

  await assert.rejects(
    () => authenticateRequest(request),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && error.status === 401,
  );
});

test("rechaza tokens que no correspondan a una sesión activa", async () => {
  const request = new Request("http://localhost/api/users", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=token-expirado` },
  });

  await assert.rejects(
    () =>
      authenticateRequest(request, {
        findActiveSessionByTokenHash: async () => null,
      }),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && error.status === 401,
  );
});
