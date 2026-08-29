import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../../src/db/migrations/033_add_password_recovery.sql", import.meta.url),
  "utf8",
);
const reversion = await readFile(
  new URL("../../src/db/migrations/reversions/033_add_password_recovery.sql", import.meta.url),
  "utf8",
);

test("la migración separa ámbitos, hashes, vencimiento y auditoría", () => {
  assert.match(migration, /CREATE TABLE password_reset_requests/);
  assert.match(migration, /token_hash CHAR\(64\) NOT NULL UNIQUE/);
  assert.match(migration, /'INTERNAL_USER', 'STORE_ACCOUNT'/);
  assert.match(migration, /consumed_at/);
  assert.match(migration, /revoked_at/);
  assert.match(migration, /CREATE TABLE password_recovery_audit/);
  assert.match(migration, /PASSWORD_RECOVERY/);
});

test("la reversión elimina en orden las referencias de outbox", () => {
  assert.match(reversion, /DELETE FROM transactional_email_provider_events/);
  assert.match(reversion, /DELETE FROM transactional_email_transitions/);
  assert.match(reversion, /DELETE FROM transactional_email_outbox/);
  assert.match(reversion, /DROP TABLE password_recovery_audit/);
  assert.match(reversion, /DROP TABLE password_reset_requests/);
});
