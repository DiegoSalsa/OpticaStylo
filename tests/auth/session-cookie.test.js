import assert from "node:assert/strict";
import test from "node:test";

import {
  createExpiredSessionCookie,
  createSessionCookie,
} from "../../src/auth/session-cookie.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session-token.js";

test("crea una cookie de sesión inaccesible para JavaScript", () => {
  const cookie = createSessionCookie("token-seguro", 3600);

  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=token-seguro;`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=3600/);
});

test("crea una cookie expirada para cerrar sesión", () => {
  assert.match(createExpiredSessionCookie(), /Max-Age=0/);
});

test("mantiene Secure en producción por defecto", () => {
  assert.match(createSessionCookie("token", 60, { NODE_ENV: "production" }), /Secure/);
});

test("permite cookies HTTP solo en el entorno universitario explícito", () => {
  assert.doesNotMatch(
    createSessionCookie("token", 60, {
      DEPLOYMENT_ENVIRONMENT: "university",
      NODE_ENV: "production",
      UNIVERSITY_INSECURE_HTTP_ALLOWED: "true",
    }),
    /Secure/,
  );
});
