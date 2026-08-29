import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../src/repositories/password-recovery-repository.js", import.meta.url),
  "utf8",
);

test("consume solicitudes con bloqueo, vencimiento y ámbito", () => {
  assert.match(source, /scope = \$2/);
  assert.match(source, /expires_at > CURRENT_TIMESTAMP/);
  assert.match(source, /consumed_at IS NULL/);
  assert.match(source, /revoked_at IS NULL/);
  assert.match(source, /FOR UPDATE/);
});

test("revoca sesiones de cada ámbito dentro de la transacción de consumo", () => {
  assert.match(source, /UPDATE user_sessions/);
  assert.match(source, /UPDATE customer_account_sessions/);
  assert.match(source, /SET consumed_at = CURRENT_TIMESTAMP/);
  assert.match(source, /SET revoked_at = CURRENT_TIMESTAMP/);
});

test("la outbox recibe solo referencias no secretas de recuperación", () => {
  assert.match(source, /'PASSWORD_RECOVERY'/);
  assert.match(source, /password_reset_request_id/);
  assert.doesNotMatch(source, /recoveryToken/);
});
