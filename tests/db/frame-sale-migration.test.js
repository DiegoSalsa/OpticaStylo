import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("la migración 030 permite ventas de montura sin alterar las anteriores", async () => {
  const migration = await readFile(fileURLToPath(new URL(
    "../../src/db/migrations/030_allow_frame_sales_without_customer.sql",
    import.meta.url,
  )), "utf8");
  const reversion = await readFile(fileURLToPath(new URL(
    "../../src/db/migrations/reversions/030_allow_frame_sales_without_customer.sql",
    import.meta.url,
  )), "utf8");

  assert.match(migration, /ALTER COLUMN customer_id DROP NOT NULL/);
  assert.match(reversion, /No se puede revertir la migración mientras existan ventas sin cliente registrado/);
  assert.match(reversion, /ALTER COLUMN customer_id SET NOT NULL/);
});
