import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runPendingMigrations } from "../../src/db/migration-runner.js";

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

test("el ejecutor aplica la migración 033 dentro de una transacción", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "opticastylo-password-recovery-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(path.join(directory, "033_add_password_recovery.sql"), migration, "utf8");
  const calls = [];
  const client = {
    query: async (sql, parameters = []) => {
      calls.push({ parameters, sql });
      if (sql.includes("SELECT version, name, checksum")) return { rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const executed = await runPendingMigrations({
    migrationsDirectory: directory,
    pool: { connect: async () => client },
  });
  const migrationIndex = calls.findIndex(({ sql }) => sql === migration);
  const beginIndex = calls.findIndex(({ sql }) => sql === "BEGIN");
  const commitIndex = calls.findIndex(({ sql }) => sql === "COMMIT");
  assert.deepEqual(executed, ["033_add_password_recovery.sql"]);
  assert.ok(beginIndex < migrationIndex && migrationIndex < commitIndex);
  assert.deepEqual(
    calls.find(({ sql }) => sql.includes("INSERT INTO schema_migrations")).parameters.slice(0, 2),
    [33, "add_password_recovery"],
  );
});
