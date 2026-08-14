import assert from "node:assert/strict";
import test from "node:test";

import {
  loginStoreAccount,
  registerStoreAccount,
} from "../../src/services/store-account-service.js";

const input = {
  address: "Av. Prueba 123",
  email: "cliente@example.com",
  firstNames: "Cliente",
  lastNames: "Prueba",
  password: "ClaveSeguraCliente2026!",
  phone: "+56912345678",
  rut: "12345678-5",
};

const stored = {
  ...input,
  customerId: "00000000-0000-4000-8000-000000000002",
  id: "00000000-0000-4000-8000-000000000001",
  isActive: true,
  passwordHash: "hash",
};

test("registra la cuenta y emite una sesión separada", async () => {
  let receivedHash = null;
  const result = await registerStoreAccount(input, {}, {
    createCustomerAccount: async (data) => { receivedHash = data.passwordHash; return stored; },
    createCustomerSession: async () => ({ id: "session" }),
    createSessionToken: () => "token",
    hashPassword: async () => "hash",
    hashSessionToken: () => "token-hash",
  });
  assert.equal(receivedHash, "hash");
  assert.equal(result.account.id, stored.id);
  assert.equal(result.token, "token");
  assert.equal(result.account.passwordHash, undefined);
});

test("traduce un RUT comercial existente a vinculación segura", async () => {
  await assert.rejects(() => registerStoreAccount(input, {}, {
    createCustomerAccount: async () => {
      const error = new Error("duplicate");
      error.code = "23505";
      error.constraint = "customers_rut_key";
      throw error;
    },
    hashPassword: async () => "hash",
  }), (error) => error.code === "CUSTOMER_ACCOUNT_REQUIRES_LINKING" && error.status === 409);
});

test("inicia sesión sin exponer si el correo existe", async () => {
  let failedRecorded = false;
  await assert.rejects(() => loginStoreAccount({
    email: input.email,
    password: input.password,
  }, {}, {
    findCustomerAccountForAuthentication: async () => stored,
    recordCustomerFailedLogin: async () => { failedRecorded = true; },
    verifyPassword: async () => false,
  }), (error) => error.code === "INVALID_CUSTOMER_CREDENTIALS");
  assert.equal(failedRecorded, true);
});

test("crea una sesión para credenciales correctas", async () => {
  const result = await loginStoreAccount({ email: input.email, password: input.password }, {}, {
    createCustomerSession: async () => ({ id: "session" }),
    createSessionToken: () => "token",
    findCustomerAccountForAuthentication: async () => stored,
    hashSessionToken: () => "hash",
    verifyPassword: async () => true,
  });
  assert.equal(result.account.customerId, stored.customerId);
});
