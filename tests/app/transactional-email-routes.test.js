import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = (path) => readFile(new URL(`../../src/app/api/${path}`, import.meta.url), "utf8");

test("la ejecución interna exige un secreto independiente y no devuelve destinatarios", async () => {
  const source = await route("internal/transactional-emails/process/route.js");
  assert.match(source, /hasValidBearerSecret\(request, process\.env\.CRON_SECRET\)/);
  assert.match(source, /maxDuration = 30/);
  assert.doesNotMatch(source, /recipientEmail|effectiveRecipientEmail|payload/);
});

test("las operaciones globales autentican y delegan la autorización administrativa", async () => {
  const metrics = await route("admin/transactional-emails/route.js");
  const retry = await route("admin/transactional-emails/[emailId]/retry/route.js");
  assert.match(metrics, /authenticateRequest\(request\)/);
  assert.match(metrics, /getTransactionalEmailOperations\(actor\)/);
  assert.match(retry, /authenticateRequest\(request\)/);
  assert.match(retry, /retryFailedTransactionalEmail\(emailId, actor\)/);
});

test("el webhook conserva el cuerpo crudo para verificar la firma", async () => {
  const source = await route("webhooks/resend/route.js");
  assert.match(source, /const rawBody = await request\.text\(\)/);
  assert.match(source, /processResendWebhook\(rawBody, request\.headers\)/);
  assert.doesNotMatch(source, /request\.json\(\)/);
});
