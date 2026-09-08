import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baselineUrl = new URL(
  "../../prisma/migrations/20260908000000_baseline/migration.sql",
  import.meta.url,
);

test("consolida las 32 migraciones históricas en un baseline", async () => {
  const baseline = await readFile(baselineUrl, "utf8");
  for (let version = 1; version <= 32; version += 1) {
    assert.match(baseline, new RegExp(`Fuente histórica: ${String(version).padStart(3, "0")}_`));
  }
});

test("el baseline crea las 49 tablas del esquema", async () => {
  const baseline = await readFile(baselineUrl, "utf8");
  assert.equal((baseline.match(/^CREATE TABLE/gm) ?? []).length, 49);
});

test("conserva las restricciones y funciones históricas", async () => {
  const baseline = await readFile(baselineUrl, "utf8");
  assert.match(baseline, /CREATE FUNCTION set_updated_at_timestamp/);
  assert.match(baseline, /products_prescription_only_for_lenses/);
});

test("usa Prisma Migrate para estado y despliegue", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts["db:migrate"], /db-migrate\.mjs/);
  assert.match(manifest.scripts["db:migrate:status"], /db-migration-status\.mjs/);
});
