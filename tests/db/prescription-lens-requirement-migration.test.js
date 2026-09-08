import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el baseline limita la receta obligatoria a los cristales ópticos", async () => {
  const baseline = await readFile(new URL(
    "../../prisma/migrations/20260908000000_baseline/migration.sql",
    import.meta.url,
  ), "utf8");
  assert.match(baseline, /SET requires_prescription = FALSE/);
  assert.match(baseline, /products_prescription_only_for_lenses/);
  assert.match(baseline, /category = 'PRESCRIPTION_LENS' OR requires_prescription = FALSE/);
});
