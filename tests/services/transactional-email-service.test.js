import assert from "node:assert/strict";
import test from "node:test";

import { EmailProviderError } from "../../src/integrations/email/resend-email-provider.js";
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
    getReminderEligibility: async () => ({ eligible: true, reason: null }),
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
    getReminderEligibility: async () => ({ eligible: false, reason: "APPOINTMENT_CANCELLED" }),
    provider: { send: async () => assert.fail("No debe enviar recordatorios cancelados") },
    suppressEmail: async (_id, _worker, value) => { reason = value; },
  });
  assert.equal((await processTransactionalEmailBatch({}, dependencies)).sent, 0);
  assert.equal(reason, "APPOINTMENT_CANCELLED");
});

test("suprime una recuperación vencida antes de renderizar o enviar", async () => {
  let reason;
  const recovery = {
    ...email,
    passwordResetRequestId: "00000000-0000-4000-8000-000000000052",
    payload: { scope: "INTERNAL_USER" },
    templateCode: "PASSWORD_RECOVERY",
  };
  const dependencies = runDependencies("live", {
    claimBatch: async () => ({ emails: [recovery], recoveredCount: 0 }),
    getEligibility: async () => ({
      eligible: false,
      reason: "PASSWORD_RECOVERY_EXPIRED",
    }),
    provider: { send: async () => assert.fail("No debe enviar recuperaciones vencidas") },
    renderEmail: () => assert.fail("No debe renderizar recuperaciones vencidas"),
    suppressEmail: async (_id, _worker, value) => { reason = value; },
  });
  assert.equal((await processTransactionalEmailBatch({}, dependencies)).sent, 0);
  assert.equal(reason, "PASSWORD_RECOVERY_EXPIRED");
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
    getReminderEligibility: async () => ({ eligible: true, reason: null }),
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
