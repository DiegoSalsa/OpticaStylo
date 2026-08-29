import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PASSWORD_RECOVERY_SCOPES } from "../../src/auth/password-recovery-token.js";
import {
  handlePasswordRecoveryRequest,
  handlePasswordResetRequest,
} from "../../src/app/api/password-recovery-handler.js";

const request = new Request("https://example.test/api/auth/password-recovery", {
  method: "POST",
});

test("la solicitud limita antes de consultar y devuelve el contrato genérico", async () => {
  const order = [];
  let serviceInput;
  const response = await handlePasswordRecoveryRequest(
    request,
    { operation: "operation-request", scope: PASSWORD_RECOVERY_SCOPES.INTERNAL_USER },
    {
      enforceRateLimit: async (_request, operation, identifier) => {
        order.push("limit");
        assert.equal(operation, "operation-request");
        assert.equal(identifier, "persona@example.test");
      },
      getMetadata: () => ({ ipAddress: "203.0.113.40" }),
      readBody: async () => {
        order.push("body");
        return { email: "persona@example.test" };
      },
      requestRecovery: async (...input) => {
        order.push("service");
        serviceInput = input;
      },
    },
  );
  assert.deepEqual(order, ["body", "limit", "service"]);
  assert.equal(serviceInput[0], PASSWORD_RECOVERY_SCOPES.INTERNAL_USER);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.match(body.data.message, /Si existe una cuenta asociada/);
});

test("el restablecimiento limita por solicitud y conserva el ámbito", async () => {
  let rateLimitIdentifier;
  let serviceScope;
  const response = await handlePasswordResetRequest(
    request,
    { operation: "operation-reset", scope: PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT },
    {
      enforceRateLimit: async (_request, _operation, identifier) => {
        rateLimitIdentifier = identifier;
      },
      getMetadata: () => ({}),
      readBody: async () => ({ recoveryRequest: "request-id" }),
      resetPassword: async (scope) => {
        serviceScope = scope;
        return { message: "resultado seguro" };
      },
    },
  );
  assert.equal(rateLimitIdentifier, "request-id");
  assert.equal(serviceScope, PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT);
  assert.deepEqual((await response.json()).data, { message: "resultado seguro" });
});

test("las cuatro rutas declaran operaciones y ámbitos separados", async () => {
  const route = (path) => readFile(new URL(`../../src/app/api/${path}`, import.meta.url), "utf8");
  const sources = await Promise.all([
    route("auth/password-recovery/route.js"),
    route("auth/password-reset/route.js"),
    route("store/accounts/password-recovery/route.js"),
    route("store/accounts/password-reset/route.js"),
  ]);
  assert.match(sources[0], /INTERNAL_PASSWORD_RECOVERY_REQUEST[\s\S]*INTERNAL_USER/);
  assert.match(sources[1], /INTERNAL_PASSWORD_RESET[\s\S]*INTERNAL_USER/);
  assert.match(sources[2], /STORE_PASSWORD_RECOVERY_REQUEST[\s\S]*STORE_ACCOUNT/);
  assert.match(sources[3], /STORE_PASSWORD_RESET[\s\S]*STORE_ACCOUNT/);
});
