import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { requestPasswordReset } from "../../src/app/api/store/accounts/password-reset/request/request-password-reset.js";
import { hashPassword, verifyPassword } from "../../src/auth/password.js";
import { prisma } from "../../src/db/prisma.js";
import { EmailProviderError } from "../../src/integrations/email/resend-email-provider.js";
import { queuePasswordReset } from "../../src/repositories/store-password-reset-repository.js";
import { getTransactionalEmailEligibility, mapEmail } from "../../src/repositories/transactional-email-repository.js";
import { loginStoreAccount } from "../../src/services/store-account-service.js";
import { preparePasswordReset, resetStorePassword } from "../../src/services/store-password-reset-service.js";
import { processTransactionalEmailById } from "../../src/services/transactional-email-service.js";
import { decryptPasswordResetCode } from "../../src/utils/store-password-reset-code.js";
import { evaluation, requireEvaluationDatabase } from "../evaluation-data.js";

requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
after(() => prisma.$disconnect());

const newPassword = "Clave-nueva-de-evaluacion-2026!";
const invalid = (error) => error.code === "PASSWORD_RESET_INVALID";
const live = { getEmailConfig: () => ({ mode: "live" }), wait: async () => {} };
const workerConfig = { mode: "live", batchSize: 1, lockSeconds: 60, maxAttempts: 3, retryBaseSeconds: 5, maxRetrySeconds: 60 };
const silentLogger = { info() {} };
const wrong = (code) => code === "123456" ? "654321" : "123456";

async function accountFor(name, passwordHash = "hash-ficticio-de-prueba") {
  const email = `reset-${name}@example.invalid`;
  const customer = await prisma.customers.create({ data: { first_names: "Cliente sintético", email } });
  return prisma.customer_accounts.create({ data: { customer_id: customer.id, email, password_hash: passwordHash } });
}

function request(email, jobs, dependencies = {}, ip) {
  const input = new Request("http://localhost/api/store/accounts/password-reset/request", {
    method: "POST", headers: { "Content-Type": "application/json", ...(ip ? { "x-real-ip": ip } : {}) }, body: JSON.stringify({ email }),
  });
  return requestPasswordReset(input, (callback) => jobs.push(callback), {
    prepare: (address, schedule, quotas) => preparePasswordReset(address, schedule, { ...live, ...quotas, ...dependencies }),
  });
}

const outbox = (challengeId) => prisma.transactional_email_outbox.findUniqueOrThrow({
  where: { deduplication_key: `CUSTOMER_PASSWORD_RESET:${challengeId}` },
});

async function issue(email, dependencies = {}) {
  const result = await preparePasswordReset(email, () => {}, { ...live, ...dependencies });
  const mail = await outbox(result.challengeId);
  return { challengeId: result.challengeId, mail, code: decryptPasswordResetCode(result.challengeId, mail.payload.encryptedCode) };
}

test("HTTP 202 espera la escritura e iguala las respuestas para correos existentes y desconocidos", async () => {
  const account = await accountFor("durable");
  const jobs = [];
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let settled = false;
  const pending = request(account.email, jobs, {
    async queueReset(input, client) {
      entered.resolve();
      await release.promise;
      return queuePasswordReset(input, client);
    },
    async sendEmail() { throw new Error("Error que contiene un dato que no debe registrarse"); },
    logger: { error(message) { assert.equal(message, "Falló el despacho inmediato del correo de recuperación."); } },
  }).then((response) => { settled = true; return response; });
  await entered.promise;
  assert.equal(settled, false);
  assert.equal(jobs.length, 0);
  release.resolve();
  const existing = await pending;
  const unknown = await request("reset-unknown@example.invalid", jobs);
  assert.equal(existing.status, 202);
  assert.equal(unknown.status, existing.status);
  assert.deepEqual([...unknown.headers], [...existing.headers]);
  const present = (await existing.json()).data;
  const absent = (await unknown.json()).data;
  assert.match(present.challengeId, /^[a-f0-9-]{36}$/);
  assert.match(absent.challengeId, /^[a-f0-9-]{36}$/);
  assert.deepEqual({ ...absent, challengeId: present.challengeId }, present);
  assert.equal(await prisma.customer_password_resets.count({ where: { id: present.challengeId } }), 1);
  assert.equal(await prisma.customer_password_resets.count({ where: { id: absent.challengeId } }), 0);
  const failureDelays = [];
  const existingCode = decryptPasswordResetCode(present.challengeId, (await outbox(present.challengeId)).payload.encryptedCode);
  for (const challengeId of [present.challengeId, absent.challengeId]) {
    await assert.rejects(() => resetStorePassword({ challengeId, code: wrong(existingCode), password: newPassword }, {
      wait: async (milliseconds) => failureDelays.push(milliseconds),
    }), invalid);
  }
  assert.equal(failureDelays.length, 2);
  assert.ok(failureDelays.every((milliseconds) => milliseconds >= 0 && milliseconds <= 320));
  assert.equal(jobs.length, 1);
  await jobs[0]();
  assert.equal((await outbox(present.challengeId)).status, "PENDING");
  assert.equal((await request(account.email, jobs)).status, 429);
});

test("un fallo de escritura en PostgreSQL revierte el desafío y la ruta responde 500 sin programar envío", async (t) => {
  t.mock.method(console, "error", () => {});
  const account = await accountFor("rollback");
  const initial = await issue(account.email);
  const original = await prisma.customer_password_resets.findUniqueOrThrow({ where: { id: initial.challengeId } });
  const jobs = [];
  const response = await request(account.email, jobs, {
    queueReset: (input, client) => queuePasswordReset({ ...input, challengeId: initial.challengeId }, client),
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
  assert.equal(jobs.length, 0);
  const afterRollback = await prisma.customer_password_resets.findUniqueOrThrow({ where: { id: initial.challengeId } });
  assert.equal(afterRollback.code_hash, original.code_hash);
  assert.equal(await prisma.transactional_email_outbox.count({ where: { account_id: account.id } }), 1);
  assert.ok(!JSON.stringify(console.error.mock.calls).includes(initial.code));
  const retry = await request(account.email, jobs);
  assert.equal(retry.status, 202);
  assert.equal(jobs.length, 1);
  assert.equal((await outbox((await retry.json()).data.challengeId)).status, "PENDING");
});

test("una interrupción de PostgreSQL da el mismo 503 para ambas direcciones y no consume cuota de envío", async (t) => {
  const errorLog = t.mock.method(console, "error", () => {});
  const account = await accountFor("connection");
  const jobs = [];
  const database = {
    async $transaction() {
      throw Object.assign(new Error(`Error privado de conexión para ${account.email}, clave 123456`), { code: "P1001" });
    },
  };
  const existing = await request(account.email, jobs, { database });
  const unknown = await request("reset-connection-unknown@example.invalid", jobs, { database });
  assert.equal(existing.status, 503);
  assert.equal(unknown.status, existing.status);
  assert.deepEqual([...unknown.headers], [...existing.headers]);
  assert.deepEqual(await unknown.json(), await existing.json());
  assert.equal(await prisma.customer_password_resets.count({ where: { account_id: account.id } }), 0);
  assert.equal(jobs.length, 0);
  assert.deepEqual(errorLog.mock.calls.map(({ arguments: args }) => args), Array(2).fill(["Almacenamiento de recuperación no disponible."]));
  assert.equal((await request(account.email, jobs)).status, 202);
});

test("sin la tabla de la migración ambos correos reciben el mismo 503 antes de consultar la cuenta", async (t) => {
  const logs = t.mock.method(console, "error", () => {});
  const account = await accountFor("missing-schema");
  const jobs = [];
  let queueCalls = 0;
  const dependencies = { queueReset() { queueCalls += 1; } };
  await prisma.$executeRaw`ALTER TABLE customer_password_resets RENAME TO synthetic_missing_reset_table`;
  try {
    const existing = await request(account.email, jobs, dependencies);
    const unknown = await request("reset-missing-schema-unknown@example.invalid", jobs, dependencies);
    assert.equal(existing.status, 503);
    assert.equal(unknown.status, existing.status);
    assert.deepEqual([...unknown.headers], [...existing.headers]);
    assert.deepEqual(await unknown.json(), await existing.json());
    assert.equal(queueCalls, 0);
    assert.equal(jobs.length, 0);
    assert.ok(!JSON.stringify(logs.mock.calls.map(({ arguments: args }) => args)).includes(account.email));
  } finally {
    await prisma.$executeRaw`ALTER TABLE synthetic_missing_reset_table RENAME TO customer_password_resets`;
  }
  assert.equal((await request(account.email, jobs)).status, 202);
});

test("mantiene el límite de red entre correos y acota también los intentos que fallan internamente", async (t) => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });
  const jobs = [];
  const acceptedNetwork = "203.0.113.37";
  for (let index = 0; index < 12; index += 1) {
    assert.equal((await request(`ip-cap-${index}@example.invalid`, jobs, {}, acceptedNetwork)).status, 202);
  }
  const blocked = await request("ip-cap-next@example.invalid", jobs, {}, acceptedNetwork);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  assert.equal((await request("ip-cap-next@example.invalid", jobs, {}, "203.0.113.38")).status, 202);

  const failedNetwork = "203.0.113.39";
  t.mock.method(console, "error", () => {});
  const failed = { async queueReset() { throw new Error("Fallo controlado antes de guardar"); } };
  for (let index = 0; index < 24; index += 1) {
    assert.equal((await request("ip-fail@example.invalid", jobs, failed, failedNetwork)).status, 500);
  }
  assert.equal((await request("ip-fail@example.invalid", jobs, failed, failedNetwork)).status, 429);
  assert.equal(jobs.length, 0);
});

test("solicitudes concurrentes respetan la espera y el reenvío invalida el código y el correo anteriores", async () => {
  const account = await accountFor("resend");
  const jobs = [];
  const responses = await Promise.all([request(account.email, jobs), request(account.email, jobs)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [202, 429]);
  const accepted = responses.find((response) => response.status === 202);
  const blocked = responses.find((response) => response.status === 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  const { challengeId } = (await accepted.json()).data;
  const oldMail = await outbox(challengeId);
  const oldCode = decryptPasswordResetCode(challengeId, oldMail.payload.encryptedCode);
  await prisma.public_request_rate_limits.updateMany({
    where: { bucket: "store_password_reset_resend:identifier", subject_hash: createHash("sha256").update(account.email).digest("hex") },
    data: { window_started_at: new Date(0), expires_at: new Date(1000) },
  });
  const resend = await request(account.email, jobs);
  assert.equal(resend.status, 202);
  const replacement = (await resend.json()).data.challengeId;
  assert.notEqual(replacement, challengeId);
  assert.equal(await prisma.customer_password_resets.count({ where: { account_id: account.id } }), 1);
  const oldWorkerMail = { ...mapEmail(oldMail, { includeOtpCode: true }), deliveryMode: "live" };
  assert.equal((await getTransactionalEmailEligibility(oldWorkerMail)).eligible, false);
  await assert.rejects(() => resetStorePassword({ challengeId, code: oldCode, password: newPassword }), invalid);
  await assert.rejects(() => resetStorePassword({ challengeId: replacement, code: oldCode, password: newPassword }), invalid);
  let sends = 0;
  await processTransactionalEmailById(oldMail.id, {
    config: workerConfig, logger: silentLogger, provider: { async send() { sends += 1; } },
  });
  const suppressed = await outbox(challengeId);
  assert.equal(sends, 0);
  assert.equal(suppressed.status, "SUPPRESSED");
  assert.equal(suppressed.payload.encryptedCode, undefined);
});

test("el worker reintenta de forma segura con un proveedor simulado y limpia el código al enviar", async () => {
  const account = await accountFor("worker");
  const { mail, code } = await issue(account.email);
  // Esta prueba verifica el reintento; el correo debe estar vencido para el
  // reloj del worker, independientemente de la precisión temporal de PostgreSQL.
  await prisma.transactional_email_outbox.update({ where: { id: mail.id }, data: { next_attempt_at: new Date(0) } });
  const workerEmail = mapEmail(mail, { includeOtpCode: true });
  assert.equal(mail.payload.code, undefined);
  assert.equal(mapEmail(mail).payload.encryptedCode, undefined);
  assert.equal(mapEmail(mail).payload.challengeId, undefined);
  assert.equal((await getTransactionalEmailEligibility({ ...workerEmail, deliveryMode: "test" })).eligible, false);
  const logs = [];
  let attempts = 0;
  const dependencies = {
    config: workerConfig,
    logger: { info: (value) => logs.push(value) },
    provider: {
      async send({ rendered, email, recipient }) {
        assert.equal(recipient, account.email);
        assert.equal(email.payload.code, undefined);
        assert.ok(rendered.text.includes(`Código de recuperación: ${code}`));
        attempts += 1;
        if (attempts === 1) throw new EmailProviderError({ code: `echo_${code}`, retryable: true });
        return { provider: "RESEND", providerMessageId: "fixture-worker" };
      },
    },
  };
  const firstAttempt = await processTransactionalEmailById(mail.id, dependencies);
  assert.equal(firstAttempt.failed, 1, JSON.stringify({ ...firstAttempt, logs }));
  const failed = await outbox(mail.payload.challengeId);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.last_error_code, "password_reset_delivery_retryable");
  assert.equal(failed.payload.encryptedCode, mail.payload.encryptedCode);
  await prisma.transactional_email_outbox.update({ where: { id: mail.id }, data: { next_attempt_at: new Date(0) } });
  assert.equal((await processTransactionalEmailById(mail.id, dependencies)).sent, 1);
  assert.equal((await outbox(mail.payload.challengeId)).payload.encryptedCode, undefined);
  assert.ok(!JSON.stringify(logs).includes(`echo_${code}`));
});

test("un correo pendiente de la versión anterior se puede enviar y su código se elimina", async () => {
  const account = await accountFor("legacy");
  const { challengeId, mail, code } = await issue(account.email);
  await prisma.transactional_email_outbox.update({ where: { id: mail.id }, data: { payload: { challengeId, code } } });
  let renderedBody;
  const result = await processTransactionalEmailById(mail.id, {
    config: workerConfig, logger: silentLogger,
    provider: {
      async send({ rendered }) {
        renderedBody = rendered.text;
        return { provider: "RESEND", providerMessageId: "fixture-legacy" };
      },
    },
  });
  assert.equal(result.sent, 1);
  assert.ok(renderedBody.includes(`Código de recuperación: ${code}`));
  assert.equal((await outbox(challengeId)).payload.code, undefined);
});

test("rechaza códigos vencidos y bloquea el desafío tras cinco errores", async () => {
  const account = await accountFor("attempts");
  const expired = await issue(account.email);
  await prisma.customer_password_resets.update({ where: { id: expired.challengeId }, data: { expires_at: new Date(0) } });
  await assert.rejects(() => resetStorePassword({ challengeId: expired.challengeId, code: expired.code, password: newPassword }), invalid);
  const current = await issue(account.email);
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(() => resetStorePassword({ challengeId: current.challengeId, code: wrong(current.code), password: newPassword }), invalid);
  }
  await assert.rejects(() => resetStorePassword({ challengeId: current.challengeId, code: current.code, password: newPassword }), invalid);
  assert.equal((await prisma.customer_password_resets.findUniqueOrThrow({ where: { id: current.challengeId } })).attempt_count, 5);
});

test("solo una confirmación simultánea consume el código, revoca sesiones y conserva el acceso con la nueva clave", async () => {
  const account = await accountFor("confirm", await hashPassword(evaluation.password));
  const session = await loginStoreAccount({ email: account.email, password: evaluation.password });
  const { challengeId, code } = await issue(account.email);
  const input = { challengeId, code, password: newPassword };
  const results = await Promise.allSettled([resetStorePassword(input), resetStorePassword(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(invalid(results.find((result) => result.status === "rejected").reason));
  const updated = await prisma.customer_accounts.findUniqueOrThrow({ where: { id: account.id } });
  assert.equal(await verifyPassword(newPassword, updated.password_hash), true);
  assert.equal(await verifyPassword(evaluation.password, updated.password_hash), false);
  assert.ok((await prisma.customer_account_sessions.findUniqueOrThrow({ where: { id: session.session.id } })).revoked_at);
  await loginStoreAccount({ email: account.email, password: newPassword });
});
