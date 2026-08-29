import assert from "node:assert/strict";
import test from "node:test";

import { PASSWORD_RECOVERY_SCOPES } from "../../src/auth/password-recovery-token.js";
import {
  consumePasswordRecoveryRequest,
  createPasswordRecoveryRequest,
} from "../../src/repositories/password-recovery-repository.js";

const requestId = "00000000-0000-4000-8000-000000000031";
const targetId = "00000000-0000-4000-8000-000000000032";

function transactionWith(client) {
  return async (operation) => operation(client);
}

test("crea la solicitud, revoca las anteriores y encola solo referencias", async () => {
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      if (sql.includes("FROM customer_accounts")) {
        return { rows: [{ email: "cuenta@example.test", id: targetId }] };
      }
      if (sql.includes("INSERT INTO password_reset_requests")) {
        return { rows: [{ id: requestId }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const result = await createPasswordRecoveryRequest({
    expiresAt: new Date("2026-08-29T12:15:00.000Z"),
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
    target: { id: targetId },
    tokenHash: "a".repeat(64),
  }, { executeTransaction: transactionWith(client) });

  assert.deepEqual(result, { id: requestId });
  assert.ok(calls.some(({ sql }) => sql.includes("SET revoked_at = CURRENT_TIMESTAMP")));
  const outbox = calls.find(({ sql }) => sql.includes("transactional_email_outbox"));
  assert.equal(outbox.parameters[1], JSON.stringify({ scope: "STORE_ACCOUNT" }));
  assert.equal(outbox.parameters.at(-1), requestId);
  assert.equal(outbox.parameters.some((value) => value === "a".repeat(64)), false);
});

test("consume en orden cuenta solicitud y revoca sesiones internas", async () => {
  const calls = [];
  const request = { customer_account_id: null, id: requestId, user_id: targetId };
  const client = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      if (sql.includes("FROM password_reset_requests") && sql.includes("SELECT *")) {
        return { rows: [request] };
      }
      if (sql.includes("FROM users")) {
        return { rows: [{ email: "persona@example.test", id: targetId }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const result = await consumePasswordRecoveryRequest({
    passwordHash: "hash-de-prueba",
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    tokenHash: "b".repeat(64),
  }, { executeTransaction: transactionWith(client) });

  const targetLock = calls.findIndex(({ sql }) => sql.includes("FROM users"));
  const requestLock = calls.findIndex(
    ({ sql }) => sql.includes("FROM password_reset_requests") && sql.includes("FOR UPDATE"),
  );
  assert.ok(targetLock >= 0 && targetLock < requestLock);
  assert.ok(calls.some(({ sql }) => sql.includes("UPDATE user_sessions")));
  assert.ok(calls.some(({ sql }) => sql.includes("SET consumed_at = CURRENT_TIMESTAMP")));
  assert.deepEqual(result, { id: requestId });
});

test("un consumo de tienda solo modifica cuenta y sesiones de tienda", async () => {
  const calls = [];
  const request = { customer_account_id: targetId, id: requestId, user_id: null };
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("FROM password_reset_requests") && sql.includes("SELECT *")) {
        return { rows: [request] };
      }
      if (sql.includes("FROM customer_accounts")) {
        return { rows: [{ email: "cuenta@example.test", id: targetId }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  await consumePasswordRecoveryRequest({
    passwordHash: "hash-de-prueba",
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
    tokenHash: "c".repeat(64),
  }, { executeTransaction: transactionWith(client) });

  assert.ok(calls.some((sql) => sql.includes("UPDATE customer_accounts")));
  assert.ok(calls.some((sql) => sql.includes("UPDATE customer_account_sessions")));
  assert.equal(calls.some((sql) => sql.includes("UPDATE user_sessions")), false);
});

test("rechaza el segundo consumo después de perder la carrera por la solicitud", async () => {
  let requestReads = 0;
  const client = {
    query: async (sql) => {
      if (sql.includes("FROM password_reset_requests") && sql.includes("SELECT *")) {
        requestReads += 1;
        return {
          rows: requestReads === 1
            ? [{ customer_account_id: null, id: requestId, user_id: targetId }]
            : [],
        };
      }
      if (sql.includes("FROM users")) {
        return { rows: [{ email: "persona@example.test", id: targetId }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const result = await consumePasswordRecoveryRequest({
    passwordHash: "hash-de-prueba",
    requestId,
    scope: PASSWORD_RECOVERY_SCOPES.INTERNAL_USER,
    tokenHash: "d".repeat(64),
  }, { executeTransaction: transactionWith(client) });
  assert.equal(result, null);
});
