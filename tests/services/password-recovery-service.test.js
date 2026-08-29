import assert from "node:assert/strict";
import test from "node:test";

import { PASSWORD_RECOVERY_SCOPES } from "../../src/auth/password-recovery-token.js";
import {
  PASSWORD_RECOVERY_REQUEST_MESSAGE,
  PASSWORD_RESET_COMPLETED_MESSAGE,
  requestPasswordRecovery,
  resetPasswordFromRecovery,
} from "../../src/services/password-recovery-service.js";

const requestId = "00000000-0000-4000-8000-000000000011";
const recoveryInput = { email: "persona@example.test" };
const resetInput = {
  password: "Una contraseña nueva y extensa",
  recoveryRequest: requestId,
  recoveryToken: Buffer.alloc(32, 7).toString("base64url"),
};

test("acepta una solicitud desconocida con la misma respuesta genérica en ambos ámbitos", async () => {
  const audits = [];
  const dependencies = {
    findTarget: async () => null,
    recordAudit: async (entry) => audits.push(entry),
  };
  const [internalResult, storeResult] = await Promise.all([
    requestPasswordRecovery(
      PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
      recoveryInput,
      {},
      dependencies,
    ),
    requestPasswordRecovery(
      PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
      recoveryInput,
      {},
      dependencies,
    ),
  ]);

  assert.deepEqual(internalResult, { message: PASSWORD_RECOVERY_REQUEST_MESSAGE });
  assert.deepEqual(storeResult, internalResult);
  assert.deepEqual(audits.map((entry) => entry.scope).sort(), [
    PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
  ].sort());
  assert.ok(audits.every((entry) => entry.event === "REQUEST_IGNORED"));
});

test("crea una recuperación sin entregar ni persistir el token en claro", async () => {
  let requestData;
  const result = await requestPasswordRecovery(
    PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
    recoveryInput,
    { ipAddress: "203.0.113.9", userAgent: "Prueba" },
    {
      createRequest: async (input) => { requestData = input; },
      createRequestId: () => requestId,
      deriveToken: () => resetInput.recoveryToken,
      findTarget: async () => ({ email: recoveryInput.email, id: "00000000-0000-4000-8000-000000000012" }),
      getConfiguration: () => ({ tokenSecret: Buffer.alloc(32, 8) }),
      hashToken: () => "a".repeat(64),
      now: () => new Date("2026-08-29T12:00:00.000Z"),
    },
  );

  assert.deepEqual(result, { message: PASSWORD_RECOVERY_REQUEST_MESSAGE });
  assert.equal(Object.hasOwn(requestData, "token"), false);
  assert.equal(requestData.tokenHash, "a".repeat(64));
  assert.equal(requestData.scope, PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT);
  assert.equal(requestData.expiresAt.toISOString(), "2026-08-29T12:15:00.000Z");
});

test("mantiene la respuesta genérica cuando la recuperación no está configurada", async () => {
  const audits = [];
  const result = await requestPasswordRecovery(
    PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    recoveryInput,
    {},
    {
      findTarget: async () => ({ email: recoveryInput.email, id: "00000000-0000-4000-8000-000000000013" }),
      getConfiguration: () => { throw new Error("configuración ausente"); },
      recordAudit: async (entry) => audits.push(entry),
    },
  );

  assert.deepEqual(result, { message: PASSWORD_RECOVERY_REQUEST_MESSAGE });
  assert.equal(audits[0].event, "REQUEST_UNAVAILABLE");
});

test("restablece la contraseña sin exponerla y solicita revocar sesiones", async () => {
  let consumption;
  const result = await resetPasswordFromRecovery(
    PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    resetInput,
    {},
    {
      consumeRequest: async (input) => {
        consumption = input;
        return { id: requestId };
      },
      hashPassword: async () => "hash-de-contraseña-nueva",
      hashToken: () => "b".repeat(64),
    },
  );

  assert.deepEqual(result, { message: PASSWORD_RESET_COMPLETED_MESSAGE });
  assert.equal(consumption.scope, PASSWORD_RECOVERY_SCOPES.INTERNAL_USER);
  assert.equal(consumption.passwordHash, "hash-de-contraseña-nueva");
  assert.equal(Object.hasOwn(consumption, "password"), false);
  assert.equal(consumption.tokenHash, "b".repeat(64));
});

test("mantiene la política vigente de quince caracteres al restablecer", async () => {
  await assert.rejects(
    () => resetPasswordFromRecovery(
      PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
      { ...resetInput, password: "corta" },
      {},
      {
        consumeRequest: async () => assert.fail("No debe consumir una solicitud inválida"),
        hashPassword: async () => assert.fail("No debe calcular un hash inválido"),
      },
    ),
    (error) => error.code === "INVALID_PASSWORD_RECOVERY_DATA" && error.status === 400,
  );
});

for (const scenario of ["inválido", "vencido", "repetido"]) {
  test(`rechaza un token ${scenario} con un único resultado seguro`, async () => {
    await assert.rejects(
      () => resetPasswordFromRecovery(
        PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
        resetInput,
        {},
        {
          consumeRequest: async () => null,
          hashPassword: async () => "hash-de-prueba",
          hashToken: () => "c".repeat(64),
        },
      ),
      (error) => error.code === "INVALID_OR_EXPIRED_PASSWORD_RECOVERY"
        && error.status === 400,
    );
  });
}

test("un consumo de cliente no acepta una solicitud del ámbito interno", async () => {
  const scopes = [];
  await assert.rejects(
    () => resetPasswordFromRecovery(
      PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
      resetInput,
      {},
      {
        consumeRequest: async (input) => {
          scopes.push(input.scope);
          return null;
        },
        hashPassword: async () => "hash-de-prueba",
        hashToken: () => "d".repeat(64),
      },
    ),
    (error) => error.code === "INVALID_OR_EXPIRED_PASSWORD_RECOVERY",
  );
  assert.deepEqual(scopes, [PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT]);
});
