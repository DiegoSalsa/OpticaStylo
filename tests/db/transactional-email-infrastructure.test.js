import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../src/db/migrations/023_complete_transactional_email_infrastructure.sql",
  import.meta.url,
);
const repositoryUrl = new URL(
  "../../src/repositories/transactional-email-repository.js",
  import.meta.url,
);
const saleRepositoryUrl = new URL(
  "../../src/repositories/sale-repository.js",
  import.meta.url,
);

test("la migración declara estados, relaciones e índices recuperables", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const status of [
    "PENDING", "PROCESSING", "SENT", "TEST_SENT", "SIMULATED", "FAILED",
    "DEAD_LETTER", "DELIVERED", "BOUNCED", "COMPLAINED", "SUPPRESSED",
  ]) assert.match(sql, new RegExp(`'${status}'`));
  for (const column of [
    "next_attempt_at", "processing_started_at", "processing_finished_at",
    "locked_at", "lock_expires_at", "locked_by", "provider_message_id",
    "effective_recipient_email", "sale_id", "payment_id", "receipt_id",
    "appointment_id", "account_id",
  ]) assert.match(sql, new RegExp(column));
  assert.match(sql, /transactional_email_expired_lock_index/);
  assert.match(sql, /transactional_email_provider_event_unique/);
});

test("dos trabajadores usan selección no bloqueante y no esperan HTTP en transacción", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /FOR UPDATE OF outbox SKIP LOCKED/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("recupera bloqueos vencidos antes de reclamar mensajes", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /lock_expires_at <= CURRENT_TIMESTAMP/);
  assert.match(source, /EXPIRED_LOCK_RECOVERED/);
  assert.match(source, /worker_abandoned/);
});

test("el trabajador actualiza el estado del comprobante POS y conserva ambos tipos", async () => {
  const repository = await readFile(repositoryUrl, "utf8");
  const saleRepository = await readFile(saleRepositoryUrl, "utf8");
  assert.match(repository, /UPDATE sale_receipts[\s\S]*email_status = \$2/);
  assert.match(saleRepository, /POS_PAYMENT_RECEIPT/);
  assert.match(saleRepository, /POS_FINAL_RECEIPT/);
  assert.doesNotMatch(saleRepository, /api\.resend\.com/);
});
