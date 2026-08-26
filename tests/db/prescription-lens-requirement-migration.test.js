import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("la migración 032 limita la receta obligatoria a los cristales ópticos", async () => {
  const migration = await readFile(fileURLToPath(new URL(
    "../../src/db/migrations/032_require_prescriptions_for_configured_lenses.sql",
    import.meta.url,
  )), "utf8");
  const reversion = await readFile(fileURLToPath(new URL(
    "../../src/db/migrations/reversions/032_require_prescriptions_for_configured_lenses.sql",
    import.meta.url,
  )), "utf8");

  assert.match(migration, /SET requires_prescription = FALSE/);
  assert.match(migration, /products_prescription_only_for_lenses/);
  assert.match(migration, /category = 'PRESCRIPTION_LENS' OR requires_prescription = FALSE/);
  assert.match(reversion, /DROP CONSTRAINT products_prescription_only_for_lenses/);
});
