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
