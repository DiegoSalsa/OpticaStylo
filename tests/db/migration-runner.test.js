import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  calculateMigrationChecksum,
  loadMigrations,
  parseMigrationFileName,
} from "../../src/db/migration-runner.js";

test("interpreta nombres válidos de migraciones", () => {
  assert.deepEqual(parseMigrationFileName("001_crear_usuarios.sql"), {
    name: "crear_usuarios",
    version: 1,
  });
});

test("rechaza nombres de migración inválidos", () => {
  assert.throws(
    () => parseMigrationFileName("crear_usuarios.sql"),
    /debe seguir el formato/,
  );
});

test("calcula un checksum estable para el contenido SQL", () => {
  const sql = "CREATE TABLE ejemplo (id INTEGER PRIMARY KEY);";

  assert.equal(calculateMigrationChecksum(sql), calculateMigrationChecksum(sql));
  assert.notEqual(
    calculateMigrationChecksum(sql),
    calculateMigrationChecksum(`${sql}\n`),
  );
});

test("carga las migraciones en orden numérico", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "opticastylo-migrations-"));
  context.after(() => rm(directory, { force: true, recursive: true }));

  await writeFile(path.join(directory, "002_segunda.sql"), "SELECT 2;", "utf8");
  await writeFile(path.join(directory, "001_primera.sql"), "SELECT 1;", "utf8");

  const migrations = await loadMigrations(directory);

  assert.deepEqual(
    migrations.map((migration) => migration.version),
    [1, 2],
  );
});
