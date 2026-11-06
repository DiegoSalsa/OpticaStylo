import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/db/prisma.js";
import { requireEvaluationDatabase } from "../tests/evaluation-data.js";
import { fixtureRut } from "../tests/rut-fixture.js";
requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
const id = "42000000-0000-4000-8000-000000000001",
  account = "42000000-0000-4000-8000-000000000002",
  sale = "42000000-0000-4000-8000-000000000003",
  file = path.join(process.env.PRESCRIPTION_TEST_OUTPUT, "customer-legacy-before.json");
async function snapshot() {
  return prisma.$queryRaw`SELECT to_jsonb(c) AS customer,(SELECT to_jsonb(a) FROM customer_accounts a WHERE a.id=${account}::uuid) AS account,(SELECT to_jsonb(s) FROM sales s WHERE s.id=${sale}::uuid) AS sale FROM customers c WHERE c.id=${id}::uuid`;
}
try {
  if (process.argv[2] === "before") {
    await prisma.$transaction(async c => {
      await c.$executeRaw`INSERT INTO customers(id,rut,first_names,email) VALUES(${id}::uuid,${fixtureRut(9599)},'Cliente histórico sintético','historico-comercio@example.invalid')`;
      await c.$executeRaw`INSERT INTO customer_accounts(id,customer_id,email,password_hash) VALUES(${account}::uuid,${id}::uuid,'historico-comercio@example.invalid','sin-clave-utilizable')`;
      await c.$executeRaw`INSERT INTO sales(id,sale_number,customer_id,status,subtotal_cents,total_cents,origin) OVERRIDING SYSTEM VALUE VALUES(${sale}::uuid,900000000,${id}::uuid,'QUOTATION',1000,1000,'IN_STORE')`;
    });
    await writeFile(file, JSON.stringify(await snapshot()));
  } else {
    const before = JSON.parse(await readFile(file, "utf8")),
      after = await snapshot();
    for (const name of ["customer", "account", "sale"]) for (const [k, v] of Object.entries(before[0][name])) assert.deepEqual(after[0][name][k], v, `${name}.${k}`);
    assert.equal(after[0].customer.record_version, 1);
    assert.equal(after[0].account.email_verified_at, null);
    assert.equal(await prisma.customer_contact_events.count(), 0);
    console.log("Migración fase 4 → 5 verificada: cliente, cuenta y cotización conservados; sin consentimiento ni verificación inventados.");
  }
} finally {
  await prisma.$disconnect();
}
