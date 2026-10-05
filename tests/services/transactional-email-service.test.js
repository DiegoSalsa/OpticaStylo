import assert from "node:assert/strict";
import test from "node:test";

import { EmailProviderError } from "../../src/integrations/email/resend-email-provider.js";
import { getTransactionalEmailEligibility, sanitizeTransactionalEmailPayload } from "../../src/repositories/transactional-email-repository.js";
import {
  calculateRetryDelaySeconds,
  getTransactionalEmailOperations,
  processTransactionalEmailBatch,
  retryFailedTransactionalEmail,
} from "../../src/services/transactional-email-service.js";
import { PERMISSIONS } from "../../src/auth/permissions.js";

const email = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000001",
  payload: { amountCents: 10000, saleNumber: 2 },
  recipientEmail: "original@example.com",
  templateCode: "PAYMENT_CONFIRMED",
};

function config(mode, overrides = {}) {
  return {
    batchSize: 10,
    lockSeconds: 60,
    maxAttempts: 3,
    maxRetrySeconds: 3_600,
    mode,
    retryBaseSeconds: 30,
    testRecipient: mode === "test" ? "seguro@example.com" : null,
    timeZone: "America/Santiago",
    ...overrides,
  };
}

function runDependencies(mode, overrides = {}) {
  let finished;
  return {
    claimBatch: async () => ({ emails: [email], recoveredCount: 0 }),
    config: config(mode),
    findSuppression: async () => null,
    finishRun: async (_id, summary) => { finished = summary; },
    get finished() { return finished; },
    getEmailEligibility: async () => ({ eligible: true, reason: null }),
    logger: { info() {} },
    startRun: async () => "run-1",
    workerId: "00000000-0000-4000-8000-000000000002",
    ...overrides,
  };
}

test("disabled no reclama ni afirma procesamiento", async () => {
  const dependencies = runDependencies("disabled", {
    claimBatch: async () => assert.fail("No debe reclamar la cola"),
  });
  const result = await processTransactionalEmailBatch({}, dependencies);
  assert.equal(result.status, "DISABLED");
  assert.equal(result.sent, 0);
});
test("el procesamiento inmediato reclama únicamente el correo OTP solicitado", async () => {
  let claimedOptions;
  const dependencies = runDependencies("live", {
    claimBatch: async (options) => {
      claimedOptions = options;
      return { emails: [], recoveredCount: 0 };
    },
  });
  const result = await processTransactionalEmailBatch({ emailId: "otp-outbox-1" }, dependencies);
  assert.equal(claimedOptions.emailId, "otp-outbox-1");
  assert.equal(result.claimed, 0);
});

// Verificar el recorrido del worker con un challenge vigente o invalidado antes de llamar a Resend.
function otpDelivery(challenge) {
  const otp = { ...email, accountId: "account-a", payload: { challengeId: "challenge-a", code: "123456" }, status: "FAILED", templateCode: "CUSTOMER_PATIENT_OTP" };
  const now = new Date("2026-09-24T12:00:00.000Z");
  const client = { customer_patient_link_challenges: { findFirst: async ({ where }) => challenge
    && challenge.id === where.id
    && challenge.account_id === where.account_id
    && challenge.consumed_at === null
    && challenge.expires_at > where.expires_at.gt
    && challenge.attempt_count < where.attempt_count.lt ? { id: challenge.id } : null } };
  let providerCalls = 0;
  let suppressed = null;
  let logged = "";
  const dependencies = runDependencies("live", {
    claimBatch: async () => ({ emails: [otp], recoveredCount: 0 }),
    completeEmail: async () => {},
    getEmailEligibility: (message) => getTransactionalEmailEligibility(message, { client, now: () => now }),
    logger: { info: (message) => { logged += message; } },
    provider: { send: async () => { providerCalls += 1; return { provider: "RESEND", providerMessageId: "provider-otp" }; } },
    suppressEmail: async (_id, _worker, reason) => {
      suppressed = { payload: sanitizeTransactionalEmailPayload(otp.templateCode, otp.payload, "SUPPRESSED"), reason, status: "SUPPRESSED" };
    },
  });
  return { dependencies, get providerCalls() { return providerCalls; }, get suppressed() { return suppressed; }, get logged() { return logged; } };
}

const validChallenge = { account_id: "account-a", attempt_count: 0, consumed_at: null, expires_at: new Date("2026-09-24T12:10:00.000Z"), id: "challenge-a" };

test("el worker envía un OTP vigente y reintenta uno FAILED válido", async () => {
  const flow = otpDelivery(validChallenge);
  const result = await processTransactionalEmailBatch({}, flow.dependencies);
  assert.equal(result.sent, 1);
  assert.equal(flow.providerCalls, 1);
  assert.equal(flow.suppressed, null);
  assert.equal(flow.logged.includes("123456"), false);
});

test("el worker suprime OTP reemplazados, expirados, agotados, ausentes y de otra cuenta", async () => {
  const now = new Date("2026-09-24T12:00:00.000Z");
  for (const challenge of [
    { ...validChallenge, consumed_at: now },
    { ...validChallenge, expires_at: now },
    { ...validChallenge, attempt_count: 5 },
    null,
    { ...validChallenge, account_id: "account-b" },
  ]) {
    const flow = otpDelivery(challenge);
    const result = await processTransactionalEmailBatch({}, flow.dependencies);
    assert.equal(result.sent, 0);
    assert.equal(flow.providerCalls, 0);
    assert.equal(flow.suppressed?.status, "SUPPRESSED");
    assert.equal(flow.suppressed.payload.code, undefined);
    assert.equal(flow.logged.includes("123456"), false);
  }
});

test("simulate procesa sin contactar al proveedor", async () => {
  let completed;
  const dependencies = runDependencies("simulate", {
    completeEmail: async (_id, _worker, result) => { completed = result; },
    provider: { send: async () => assert.fail("No debe usar red") },
  });
  const result = await processTransactionalEmailBatch({}, dependencies);
  assert.deepEqual(completed, { status: "SIMULATED" });
  assert.equal(result.simulated, 1);
});

test("test redirige al único destinatario seguro y conserva el original", async () => {
  let recipient;
  let completion;
  const dependencies = runDependencies("test", {
    completeEmail: async (_id, _worker, result) => { completion = result; },
    provider: {
      send: async (request) => {
        recipient = request.recipient;
        return { provider: "RESEND", providerMessageId: "provider-1" };
      },
    },
  });
  await processTransactionalEmailBatch({}, dependencies);
  assert.equal(recipient, "seguro@example.com");
  assert.equal(email.recipientEmail, "original@example.com");
  assert.equal(completion.status, "TEST_SENT");
  assert.equal(completion.effectiveRecipientEmail, "seguro@example.com");
});

test("live usa el destinatario original", async () => {
  let recipient;
  const dependencies = runDependencies("live", {
    completeEmail: async () => {},
    provider: {
      send: async (request) => {
        recipient = request.recipient;
        return { provider: "RESEND", providerMessageId: "provider-2" };
      },
    },
  });
  assert.equal((await processTransactionalEmailBatch({}, dependencies)).sent, 1);
  assert.equal(recipient, email.recipientEmail);
});

test("programa reintento progresivo ante error temporal", async () => {
  let failure;
  const dependencies = runDependencies("live", {
    failEmail: async (_id, _worker, input) => {
      failure = input;
      return { status: "FAILED" };
    },
    now: () => new Date("2026-08-22T12:00:00.000Z").getTime(),
    provider: {
      send: async () => { throw new EmailProviderError({ code: "timeout", retryable: true }); },
    },
    random: () => 0.5,
  });
  const result = await processTransactionalEmailBatch({}, dependencies);
  assert.equal(result.failed, 1);
  assert.equal(failure.permanent, false);
  assert.equal(failure.nextAttemptAt.toISOString(), "2026-08-22T12:00:30.000Z");
});

test("lleva un error permanente a dead letter", async () => {
  let failure;
  const dependencies = runDependencies("live", {
    failEmail: async (_id, _worker, input) => {
      failure = input;
      return { status: "DEAD_LETTER" };
    },
    provider: {
      send: async () => {
        throw new EmailProviderError({ code: "validation_error", retryable: false });
      },
    },
  });
  const result = await processTransactionalEmailBatch({}, dependencies);
  assert.equal(result.deadLetter, 1);
  assert.equal(failure.permanent, true);
});

test("lleva a dead letter un error temporal cuando se agotan los intentos", async () => {
  let failure;
  const exhausted = { ...email, attemptCount: 3 };
  const dependencies = runDependencies("live", {
    claimBatch: async () => ({ emails: [exhausted], recoveredCount: 0 }),
    failEmail: async (_id, _worker, input) => {
      failure = input;
      return { status: exhausted.attemptCount >= input.maxAttempts ? "DEAD_LETTER" : "FAILED" };
    },
    provider: {
      send: async () => { throw new EmailProviderError({ code: "timeout", retryable: true }); },
    },
  });
  const result = await processTransactionalEmailBatch({}, dependencies);
  assert.equal(result.deadLetter, 1);
  assert.equal(failure.permanent, false);
  assert.equal(failure.maxAttempts, 3);
});

test("omite una reserva cancelada y registra el motivo", async () => {
  let reason;
  const reminder = { ...email, appointmentId: "appointment-1", templateCode: "APPOINTMENT_REMINDER" };
  const dependencies = runDependencies("live", {
    claimBatch: async () => ({ emails: [reminder], recoveredCount: 0 }),
    getEmailEligibility: async () => ({ eligible: false, reason: "APPOINTMENT_CANCELLED" }),
    provider: { send: async () => assert.fail("No debe enviar recordatorios cancelados") },
    suppressEmail: async (_id, _worker, value) => { reason = value; },
  });
  assert.equal((await processTransactionalEmailBatch({}, dependencies)).sent, 0);
  assert.equal(reason, "APPOINTMENT_CANCELLED");
});

test("añade jitter controlado y respeta máximo", () => {
  assert.equal(calculateRetryDelaySeconds({
    attemptCount: 2, baseSeconds: 30, maxSeconds: 3600, random: () => 0,
  }), 48);
  assert.equal(calculateRetryDelaySeconds({
    attemptCount: 20, baseSeconds: 30, maxSeconds: 3600, random: () => 1,
  }), 3600);
});

test("dos trabajadores simultáneos no procesan dos veces el mismo mensaje", async () => {
  const queue = [email];
  let providerCalls = 0;
  const shared = {
    claimBatch: async () => ({ emails: queue.splice(0, 1), recoveredCount: 0 }),
    completeEmail: async () => {},
    config: config("live"),
    findSuppression: async () => null,
    finishRun: async () => {},
    getEmailEligibility: async () => ({ eligible: true, reason: null }),
    logger: { info() {} },
    provider: {
      send: async () => {
        providerCalls += 1;
        return { provider: "RESEND", providerMessageId: "provider-shared" };
      },
    },
    startRun: async () => "run-concurrent",
  };
  const [first, second] = await Promise.all([
    processTransactionalEmailBatch({}, {
      ...shared,
      workerId: "00000000-0000-4000-8000-000000000003",
    }),
    processTransactionalEmailBatch({}, {
      ...shared,
      workerId: "00000000-0000-4000-8000-000000000004",
    }),
  ]);
  assert.equal(first.claimed + second.claimed, 1);
  assert.equal(providerCalls, 1);
});

test("informa bloqueos vencidos recuperados aunque el lote quede vacío", async () => {
  const dependencies = runDependencies("simulate", {
    claimBatch: async () => ({ emails: [], recoveredCount: 2 }),
  });
  const result = await processTransactionalEmailBatch({}, dependencies);
  assert.equal(result.recovered, 2);
  assert.equal(result.claimed, 0);
});

test("impide a SALES consultar o reintentar la cola global", async () => {
  const salesActor = { permissions: [PERMISSIONS.SALES_READ], userId: "sales-1" };
  await assert.rejects(
    () => getTransactionalEmailOperations(salesActor, {
      getMetrics: async () => assert.fail("No debe consultar métricas"),
    }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS",
  );
  await assert.rejects(
    () => retryFailedTransactionalEmail(email.id, salesActor, {
      retryEmail: async () => assert.fail("No debe reintentar"),
    }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS",
  );
});

test("administración recibe diagnóstico seguro y puede reintentar", async () => {
  const actor = {
    permissions: [PERMISSIONS.TRANSACTIONAL_EMAILS_MANAGE],
    userId: "00000000-0000-4000-8000-000000000009",
  };
  const operations = await getTransactionalEmailOperations(actor, {
    environment: { APP_TIME_ZONE: "America/Santiago", EMAIL_MODE: "disabled" },
    getMetrics: async () => ({ pending: 1 }),
  });
  assert.equal(operations.configuration.mode, "disabled");
  assert.equal(operations.metrics.pending, 1);
  const retried = await retryFailedTransactionalEmail(email.id, actor, {
    retryEmail: async () => ({ email: { id: email.id, status: "PENDING" }, reason: null }),
  });
  assert.deepEqual(retried, { id: email.id, status: "PENDING" });
});

