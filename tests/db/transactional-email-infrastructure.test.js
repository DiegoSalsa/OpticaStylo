import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baselineUrl = new URL("../../prisma/migrations/20260908000000_baseline/migration.sql", import.meta.url);
const repositoryUrl = new URL("../../src/repositories/transactional-email-repository.js", import.meta.url);
const saleRepositoryUrl = new URL("../../src/repositories/sale-repository.js", import.meta.url);

test("el baseline declara estados, relaciones e índices recuperables", async () => {
  const sql = await readFile(baselineUrl, "utf8");
  for (const status of ["PENDING", "PROCESSING", "SENT", "TEST_SENT", "SIMULATED", "FAILED", "DEAD_LETTER", "DELIVERED", "BOUNCED", "COMPLAINED", "SUPPRESSED"]) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.match(sql, /transactional_email_expired_lock_index/);
  assert.match(sql, /transactional_email_provider_event_unique/);
});

test("dos trabajadores reclaman filas mediante actualización condicional atómica", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /updateMany/);
  assert.match(source, /status: \{ in: \["PENDING", "FAILED"\] \}/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("recupera bloqueos vencidos antes de reclamar mensajes", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /lock_expires_at: \{ lte: now \}/);
  assert.match(source, /EXPIRED_LOCK_RECOVERED/);
  assert.match(source, /worker_abandoned/);
});

test("actualiza comprobantes POS mediante Prisma y conserva ambos tipos", async () => {
  const repository = await readFile(repositoryUrl, "utf8");
  const saleRepository = await readFile(saleRepositoryUrl, "utf8");
  assert.match(repository, /client\.sale_receipts\.update/);
  assert.match(saleRepository, /POS_PAYMENT_RECEIPT/);
  assert.match(saleRepository, /POS_FINAL_RECEIPT/);
  assert.doesNotMatch(saleRepository, /api\.resend\.com/);
});
