import { randomUUID } from "node:crypto";

import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  getTransactionalEmailConfig,
  getTransactionalEmailDiagnostic,
} from "../config/transactional-email.js";
import {
  EmailProviderError,
  createResendEmailProvider,
} from "../integrations/email/resend-email-provider.js";
import { renderTransactionalEmail } from "../integrations/email/transactional-email-template.js";
import {
  claimTransactionalEmailBatch,
  completeTransactionalEmail,
  failTransactionalEmail,
  findRecipientSuppression,
  finishTransactionalEmailWorkerRun,
  getTransactionalEmailEligibility,
  getTransactionalEmailMetrics,
  retryTransactionalEmail,
  startTransactionalEmailWorkerRun,
  suppressTransactionalEmail,
} from "../repositories/transactional-email-repository.js";
import { AppError } from "../utils/app-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function calculateRetryDelaySeconds({
  attemptCount,
  baseSeconds,
  maxSeconds,
  random = Math.random,
  retryAfterSeconds = null,
}) {
  const exponential = Math.min(
    maxSeconds,
    baseSeconds * (2 ** Math.max(0, attemptCount - 1)),
  );
  const jitterFactor = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  const jittered = Math.max(1, Math.round(exponential * jitterFactor));
  return Math.min(maxSeconds, Math.max(jittered, retryAfterSeconds ?? 0));
}

function emptySummary(mode) {
  return {
    claimed: 0,
    deadLetter: 0,
    failed: 0,
    mode,
    recovered: 0,
    sent: 0,
    simulated: 0,
    status: mode === "disabled" ? "DISABLED" : "SUCCESS",
  };
}

function logTransition(logger, emailId, status, code = null) {
  logger.info(JSON.stringify({
    code,
    emailId,
    event: "transactional_email_transition",
    status,
  }));
}

export async function processTransactionalEmailBatch(options = {}, dependencies = {}) {
  const config = dependencies.config
    ?? getTransactionalEmailConfig(dependencies.environment);
  const summary = emptySummary(config.mode);
  const workerId = dependencies.workerId ?? randomUUID();
  const startRun = dependencies.startRun ?? startTransactionalEmailWorkerRun;
  const finishRun = dependencies.finishRun ?? finishTransactionalEmailWorkerRun;
  const logger = dependencies.logger ?? console;
  const runId = await startRun({
    deliveryMode: config.mode === "disabled" ? null : config.mode,
    triggerSource: options.triggerSource ?? "manual",
    workerId,
  });

  if (config.mode === "disabled") {
    await finishRun(runId, summary);
    return summary;
  }

  try {
    const claim = await (dependencies.claimBatch ?? claimTransactionalEmailBatch)({
    deliveryMode: config.mode,
    effectiveTestRecipient: config.testRecipient,
    limit: Math.min(options.limit ?? config.batchSize, config.batchSize),
    lockSeconds: config.lockSeconds,
    workerId,
  });
  summary.claimed = claim.emails.length;
  summary.recovered = claim.recoveredCount;
  const provider = dependencies.provider
    ?? createResendEmailProvider(config, dependencies.providerDependencies);

  for (const email of claim.emails) {
    const eligibility = await (
      dependencies.getEligibility
      ?? dependencies.getReminderEligibility
      ?? getTransactionalEmailEligibility
    )(email);
    if (!eligibility.eligible) {
      await (dependencies.suppressEmail ?? suppressTransactionalEmail)(
        email.id,
        workerId,
        eligibility.reason,
      );
      logTransition(logger, email.id, "SUPPRESSED", eligibility.reason);
      continue;
    }

    if (config.mode === "live") {
      const suppression = await (
        dependencies.findSuppression ?? findRecipientSuppression
      )(email.id, email.recipientEmail);
      if (suppression) {
        await (dependencies.suppressEmail ?? suppressTransactionalEmail)(
          email.id,
          workerId,
          `RECIPIENT_${suppression}`,
        );
        logTransition(logger, email.id, "SUPPRESSED", `RECIPIENT_${suppression}`);
        continue;
      }
    }

    if (config.mode === "simulate") {
      await (dependencies.completeEmail ?? completeTransactionalEmail)(
        email.id,
        workerId,
        { status: "SIMULATED" },
      );
      summary.simulated += 1;
      logTransition(logger, email.id, "SIMULATED");
      continue;
    }

    try {
      const rendered = (dependencies.renderEmail ?? renderTransactionalEmail)(email, {
        mode: config.mode,
        timeZone: config.timeZone,
      });
      const recipient = config.mode === "test"
        ? config.testRecipient
        : email.recipientEmail;
      const delivery = await provider.send({ email, recipient, rendered });
      const status = config.mode === "test" ? "TEST_SENT" : "SENT";
      await (dependencies.completeEmail ?? completeTransactionalEmail)(
        email.id,
        workerId,
        {
          effectiveRecipientEmail: recipient,
          provider: delivery.provider,
          providerMessageId: delivery.providerMessageId,
          status,
        },
      );
      summary.sent += 1;
      logTransition(logger, email.id, status);
    } catch (error) {
      const providerError = error instanceof EmailProviderError
        ? error
        : new EmailProviderError({ code: "template_or_worker_error", retryable: false });
      const delaySeconds = calculateRetryDelaySeconds({
        attemptCount: email.attemptCount,
        baseSeconds: config.retryBaseSeconds,
        maxSeconds: config.maxRetrySeconds,
        random: dependencies.random,
        retryAfterSeconds: providerError.retryAfterSeconds,
      });
      const failed = await (dependencies.failEmail ?? failTransactionalEmail)(
        email.id,
        workerId,
        {
          errorCode: providerError.code,
          maxAttempts: config.maxAttempts,
          nextAttemptAt: new Date((dependencies.now?.() ?? Date.now()) + delaySeconds * 1_000),
          permanent: !providerError.retryable,
        },
      );
      if (failed?.status === "DEAD_LETTER") summary.deadLetter += 1;
      else summary.failed += 1;
      logTransition(logger, email.id, failed?.status ?? "FAILED", providerError.code);
    }
  }

    summary.status = summary.failed > 0 || summary.deadLetter > 0 ? "PARTIAL" : "SUCCESS";
    await finishRun(runId, summary);
    return summary;
  } catch (error) {
    summary.status = "FAILED";
    await finishRun(runId, summary);
    throw error;
  }
}

export async function getTransactionalEmailOperations(actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.TRANSACTIONAL_EMAILS_MANAGE]);
  return {
    configuration: (dependencies.getDiagnostic ?? getTransactionalEmailDiagnostic)(
      dependencies.environment,
    ),
    metrics: await (dependencies.getMetrics ?? getTransactionalEmailMetrics)(),
  };
}

export async function retryFailedTransactionalEmail(emailId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.TRANSACTIONAL_EMAILS_MANAGE]);
  if (typeof emailId !== "string" || !UUID_PATTERN.test(emailId)) {
    throw new AppError({
      code: "INVALID_TRANSACTIONAL_EMAIL_ID",
      message: "El identificador del correo no es válido.",
      status: 400,
    });
  }
  const result = await (dependencies.retryEmail ?? retryTransactionalEmail)(
    emailId.toLowerCase(),
    actor.userId,
  );
  if (result.reason === "RATE_LIMITED") {
    throw new AppError({
      code: "TRANSACTIONAL_EMAIL_RETRY_RATE_LIMITED",
      message: "Se alcanzó el límite temporal de reintentos manuales.",
      status: 429,
    });
  }
  if (result.reason === "NOT_FOUND") {
    throw new AppError({
      code: "TRANSACTIONAL_EMAIL_NOT_FOUND",
      message: "No se encontró el correo solicitado.",
      status: 404,
    });
  }
  if (result.reason === "NOT_RETRYABLE") {
    throw new AppError({
      code: "TRANSACTIONAL_EMAIL_NOT_RETRYABLE",
      message: "El correo no se encuentra en un estado reintentable.",
      status: 409,
    });
  }
  return { id: result.email.id, status: result.email.status };
}
