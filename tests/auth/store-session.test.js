import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticateCustomerRequest,
  createStoreCartCookie,
  createStoreSessionCookie,
} from "../../src/auth/store-session.js";

test("crea cookies de cuenta y carrito inaccesibles para JavaScript", () => {
  for (const cookie of [
    createStoreSessionCookie("token", 60),
    createStoreCartCookie("token", 60),
  ]) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  }
});

test("autentica la sesión de comprador sin mezclar la cookie interna", async () => {
  const request = new Request("http://localhost", {
    headers: { cookie: "opticastylo_customer_session=customer-token; opticastylo_session=staff-token" },
  });
  const result = await authenticateCustomerRequest(request, {
    findSession: async (hash) => {
      assert.equal(hash.length, 64);
      return { id: "account" };
    },
  });
  assert.equal(result.id, "account");
});

test("permite autenticación opcional para el flujo invitado", async () => {
  const request = new Request("http://localhost");
  assert.equal(await authenticateCustomerRequest(request, { optional: true }), null);
});
