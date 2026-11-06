import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/db/prisma.js";
import { requireEvaluationDatabase } from "../tests/evaluation-data.js";
requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
const id = "46000000-0000-4000-8000-000000000099";
const file = path.join(process.env.PRESCRIPTION_TEST_OUTPUT, "shipping-upgrade-before.json");
try {
  if (process.argv[2] === "before") {
    await prisma.$executeRaw`INSERT INTO sales(id,sale_number,status,subtotal_cents,total_cents,origin,shipping_fee_cents,shipping_quote_source) OVERRIDING SYSTEM VALUE VALUES(${id}::uuid,900000001,'QUOTATION',1000,1100,'IN_STORE',100,'MOCK')`;
    await writeFile(file, JSON.stringify(await prisma.$queryRaw`SELECT to_jsonb(s) AS sale FROM sales s WHERE id=${id}::uuid`));
  } else {
    const before = JSON.parse(await readFile(file, "utf8"));
    const after = await prisma.$queryRaw`SELECT to_jsonb(s) AS sale FROM sales s WHERE id=${id}::uuid`;
    for (const [k,v] of Object.entries(before[0].sale)) assert.deepEqual(after[0].sale[k], v, k);
    assert.equal(after[0].sale.shipping_quote_id, null);
    assert.equal(await prisma.shipping_shipments.count(), 0);
    assert.equal(await prisma.branches.count({ where: { shipping_enabled: true } }), 0);
    console.log("Fase 5 → 6: importes, estado y campos históricos conservados; ningún despacho ni origen habilitado inventado.");
  }
} finally { await prisma.$disconnect(); }
