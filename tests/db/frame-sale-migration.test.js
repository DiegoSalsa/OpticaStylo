import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el baseline permite ventas POS sin cliente", async () => {
  const baseline = await readFile(new URL(
    "../../prisma/migrations/20260908000000_baseline/migration.sql",
    import.meta.url,
  ), "utf8");
  assert.match(baseline, /Fuente histórica: 030_allow_frame_sales_without_customer\.sql/);
  assert.match(baseline, /ALTER COLUMN customer_id DROP NOT NULL/);
});
