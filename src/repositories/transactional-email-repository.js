import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma.js";

const FINAL_STATUSES = new Set(["SENT", "TEST_SENT", "SIMULATED", "DEAD_LETTER", "DELIVERED", "BOUNCED", "COMPLAINED", "SUPPRESSED"]);
const WEBHOOK_STATUSES = Object.freeze({
  "email.bounced": "BOUNCED", "email.complained": "COMPLAINED",
  "email.delivered": "DELIVERED", "email.failed": "DEAD_LETTER",
  "email.suppressed": "SUPPRESSED",
});

function numberOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function mapEmail(row) {
  if (!row) return null;
  const receipt = row.sale_receipts;
  const receiptPayload = receipt?.payload ?? {};
  return {
    accountId: row.account_id, appointmentId: row.appointment_id,
    attemptCount: Number(row.attempt_count), createdAt: row.created_at,
    deduplicationKey: row.deduplication_key, deliveryMode: row.delivery_mode,
    effectiveRecipientEmail: row.effective_recipient_email, id: row.id,
    lastError: row.last_error, lastErrorCode: row.last_error_code,
    lockExpiresAt: row.lock_expires_at, lockedBy: row.locked_by,
    nextAttemptAt: row.next_attempt_at, paymentId: row.payment_id,
    payload: {
      ...row.payload,
      ...(receipt ? {
        balanceCents: numberOrNull(receiptPayload.balanceCents),
        paidCents: numberOrNull(receiptPayload.paidCents),
        receiptNumber: Number(receipt.receipt_number),
        saleNumber: numberOrNull(receiptPayload.saleNumber),
        totalCents: numberOrNull(receiptPayload.totalCents),
      } : {}),
    },
    processingFinishedAt: row.processing_finished_at,
    processingStartedAt: row.processing_started_at, provider: row.provider,
    providerMessageId: row.provider_message_id, receiptId: row.receipt_id,
    recipientEmail: row.recipient_email, saleId: row.sale_id,
    scheduledAt: row.scheduled_at, sentAt: row.sent_at,
    skipReason: row.skip_reason, status: row.status,
    templateCode: row.template_code, updatedAt: row.updated_at,
  };
}

async function transition(client, email, toStatus, reasonCode, errorCode = null, actorId = null) {
  await client.transactional_email_transitions.create({ data: {
    actor_id: actorId, attempt_count: Number(email.attempt_count), email_id: email.id,
    error_code: errorCode, from_status: email.status, reason_code: reasonCode,
    to_status: toStatus,
  } });
}

async function updateReceiptStatus(client, receiptId, status, providerId = null, error = null) {
  if (!receiptId) return;
  await client.sale_receipts.update({ data: {
    email_error: error, email_provider_id: providerId,
    email_status: status, email_updated_at: new Date(),
  }, where: { id: receiptId } });
}

async function recoverExpiredLocks(client, limit) {
  const now = new Date();
  const expired = await client.transactional_email_outbox.findMany({
    orderBy: [{ lock_expires_at: "asc" }, { id: "asc" }], take: limit,
    where: { lock_expires_at: { lte: now }, status: "PROCESSING" },
  });
  let recovered = 0;
  for (const email of expired) {
    const update = await client.transactional_email_outbox.updateMany({
      data: {
        last_error: "El trabajador anterior no finalizó el procesamiento.",
        last_error_code: "worker_abandoned", lock_expires_at: null,
        locked_at: null, locked_by: null, next_attempt_at: now,
        processing_finished_at: now, status: "FAILED",
      },
      where: { id: email.id, lock_expires_at: { lte: now }, status: "PROCESSING" },
    });
    if (!update.count) continue;
    recovered += 1;
    await updateReceiptStatus(client, email.receipt_id, "FAILED", null, "El trabajador anterior no finalizó el procesamiento.");
    await transition(client, email, "FAILED", "EXPIRED_LOCK_RECOVERED", "worker_abandoned");
  }
  return recovered;
}

export async function claimTransactionalEmailBatch({ deliveryMode, effectiveTestRecipient = null, limit, lockSeconds, workerId }) {
  return prisma.$transaction(async (client) => {
    const recoveredCount = await recoverExpiredLocks(client, limit);
    const now = new Date();
    const candidates = await client.transactional_email_outbox.findMany({
      include: { sale_receipts: true },
      orderBy: [{ next_attempt_at: "asc" }, { created_at: "asc" }, { id: "asc" }],
      take: limit * 2,
      where: { next_attempt_at: { lte: now }, status: { in: ["PENDING", "FAILED"] } },
    });
    const claimed = [];
    for (const email of candidates) {
      if (claimed.length >= limit) break;
      const effectiveRecipient = deliveryMode === "test"
        ? effectiveTestRecipient : deliveryMode === "live" ? email.recipient_email : null;
      const update = await client.transactional_email_outbox.updateMany({
        data: {
          attempt_count: { increment: 1 }, delivery_mode: deliveryMode,
          effective_recipient_email: effectiveRecipient, last_error: null,
          last_error_code: null, lock_expires_at: new Date(now.getTime() + lockSeconds * 1000),
          locked_at: now, locked_by: workerId, processing_finished_at: null,
          processing_started_at: now, skip_reason: null, status: "PROCESSING",
        },
        where: { id: email.id, next_attempt_at: { lte: now }, status: { in: ["PENDING", "FAILED"] } },
      });
      if (!update.count) continue;
      const current = await client.transactional_email_outbox.findUnique({
        include: { sale_receipts: true }, where: { id: email.id },
      });
      await updateReceiptStatus(client, current.receipt_id, "PROCESSING");
      await transition(client, { ...email, attempt_count: current.attempt_count }, "PROCESSING", "WORKER_CLAIMED");
      claimed.push(mapEmail(current));
    }
    return { emails: claimed, recoveredCount };
  }, { isolationLevel: "Serializable" });
}

export async function completeTransactionalEmail(emailId, workerId, { effectiveRecipientEmail = null, provider = null, providerMessageId = null, status }) {
  return prisma.$transaction(async (client) => {
    const email = await client.transactional_email_outbox.findFirst({ where: { id: emailId, locked_by: workerId, status: "PROCESSING" } });
    if (!email) return null;
    const sentAt = ["SENT", "TEST_SENT"].includes(status) ? new Date() : null;
    await client.transactional_email_outbox.update({ data: {
      effective_recipient_email: effectiveRecipientEmail, last_error: null,
      last_error_code: null, lock_expires_at: null, locked_at: null, locked_by: null,
      processing_finished_at: new Date(), provider, provider_message_id: providerMessageId,
      sent_at: sentAt, status,
    }, where: { id: emailId } });
    await updateReceiptStatus(client, email.receipt_id, status, providerMessageId);
    await transition(client, email, status, status === "SIMULATED" ? "SIMULATION_COMPLETED" : "PROVIDER_ACCEPTED");
    let finalStatus = status;
    if (provider && providerMessageId) {
      await client.transactional_email_provider_events.updateMany({
        data: { email_id: emailId },
        where: { email_id: null, provider, provider_message_id: providerMessageId },
      });
      const pending = await client.transactional_email_provider_events.findFirst({
        orderBy: [{ occurred_at: "desc" }, { received_at: "desc" }],
        where: {
          email_id: emailId,
          event_type: { in: ["email.delivered", "email.bounced", "email.complained", "email.suppressed", "email.failed"] },
        },
      });
      const webhookStatus = WEBHOOK_STATUSES[pending?.event_type];
      if (webhookStatus) {
        finalStatus = webhookStatus;
        await client.transactional_email_outbox.update({ data: { status: webhookStatus }, where: { id: emailId } });
        await updateReceiptStatus(client, email.receipt_id, webhookStatus, providerMessageId);
        await transition(client, { ...email, status }, webhookStatus, "EARLY_PROVIDER_WEBHOOK");
      }
    }
    const result = await client.transactional_email_outbox.findUnique({ include: { sale_receipts: true }, where: { id: emailId } });
    return mapEmail({ ...result, status: finalStatus });
  });
}

export async function failTransactionalEmail(emailId, workerId, { errorCode, maxAttempts, nextAttemptAt, permanent }) {
  return prisma.$transaction(async (client) => {
    const email = await client.transactional_email_outbox.findFirst({ where: { id: emailId, locked_by: workerId, status: "PROCESSING" } });
    if (!email) return null;
    const status = permanent || email.attempt_count >= maxAttempts ? "DEAD_LETTER" : "FAILED";
    const message = status === "DEAD_LETTER"
      ? "El mensaje requiere revisión administrativa."
      : "El mensaje se reintentará después de un error temporal.";
    const result = await client.transactional_email_outbox.update({ data: {
      last_error: message, last_error_code: errorCode, lock_expires_at: null,
      locked_at: null, locked_by: null, next_attempt_at: nextAttemptAt,
      processing_finished_at: new Date(), status,
    }, include: { sale_receipts: true }, where: { id: emailId } });
    await updateReceiptStatus(client, email.receipt_id, status, null, message);
    await transition(client, email, status, status === "DEAD_LETTER" ? "RETRY_EXHAUSTED_OR_PERMANENT" : "RETRY_SCHEDULED", errorCode);
    return mapEmail(result);
  });
}

export async function suppressTransactionalEmail(emailId, workerId, reasonCode) {
  return prisma.$transaction(async (client) => {
    const email = await client.transactional_email_outbox.findFirst({ where: { id: emailId, locked_by: workerId, status: "PROCESSING" } });
    if (!email) return null;
    const result = await client.transactional_email_outbox.update({ data: {
      lock_expires_at: null, locked_at: null, locked_by: null,
      processing_finished_at: new Date(), skip_reason: reasonCode, status: "SUPPRESSED",
    }, include: { sale_receipts: true }, where: { id: emailId } });
    await updateReceiptStatus(client, email.receipt_id, "SUPPRESSED", null, reasonCode);
    await transition(client, email, "SUPPRESSED", reasonCode);
    return mapEmail(result);
  });
}

export async function getAppointmentReminderEligibility(email) {
  if (email.templateCode !== "APPOINTMENT_REMINDER" || !email.appointmentId) return { eligible: true, reason: null };
  const appointment = await prisma.appointments.findUnique({ select: { start_at: true, status: true }, where: { id: email.appointmentId } });
  if (!appointment) return { eligible: false, reason: "APPOINTMENT_NOT_FOUND" };
  if (appointment.status !== "CONFIRMED") return { eligible: false, reason: `APPOINTMENT_${appointment.status}`.slice(0, 80) };
  if (appointment.start_at.getTime() <= Date.now()) return { eligible: false, reason: "APPOINTMENT_ALREADY_STARTED" };
  return { eligible: true, reason: null };
}

export async function findRecipientSuppression(emailId, recipientEmail) {
  return (await prisma.transactional_email_outbox.findFirst({
    orderBy: { updated_at: "desc" }, select: { status: true },
    where: {
      delivery_mode: "live", id: { not: emailId }, recipient_email: recipientEmail,
      status: { in: ["BOUNCED", "COMPLAINED", "SUPPRESSED"] },
    },
  }))?.status ?? null;
}

export async function startTransactionalEmailWorkerRun({ deliveryMode, triggerSource, workerId }) {
  return (await prisma.transactional_email_worker_runs.create({ data: {
    delivery_mode: deliveryMode, trigger_source: triggerSource, worker_id: workerId,
  } })).id;
}

export async function finishTransactionalEmailWorkerRun(runId, summary) {
  await prisma.transactional_email_worker_runs.update({ data: {
    claimed_count: summary.claimed, dead_letter_count: summary.deadLetter,
    failed_count: summary.failed, finished_at: new Date(), recovered_count: summary.recovered,
    sent_count: summary.sent, simulated_count: summary.simulated, status: summary.status,
  }, where: { id: runId } });
}

export async function getTransactionalEmailMetrics() {
  const [groups, oldest, lastRun] = await Promise.all([
    prisma.transactional_email_outbox.groupBy({ _count: { _all: true }, by: ["status"] }),
    prisma.transactional_email_outbox.findFirst({
      orderBy: { created_at: "asc" }, select: { created_at: true },
      where: { status: { in: ["PENDING", "FAILED"] } },
    }),
    prisma.transactional_email_worker_runs.findFirst({
      orderBy: { finished_at: "desc" }, select: { finished_at: true }, where: { status: "SUCCESS" },
    }),
  ]);
  const counts = new Map(groups.map((item) => [item.status, item._count._all]));
  return {
    deadLetter: counts.get("DEAD_LETTER") ?? 0, failed: counts.get("FAILED") ?? 0,
    lastSuccessfulRunAt: lastRun?.finished_at ?? null,
    oldestPendingSeconds: oldest ? Math.max(0, Math.floor((Date.now() - oldest.created_at.getTime()) / 1000)) : null,
    pending: counts.get("PENDING") ?? 0, processing: counts.get("PROCESSING") ?? 0,
    sent: (counts.get("SENT") ?? 0) + (counts.get("TEST_SENT") ?? 0) + (counts.get("DELIVERED") ?? 0),
  };
}

export async function retryTransactionalEmail(emailId, actorId, limitPerHour = 10) {
  return prisma.$transaction(async (client) => {
    const attempts = await client.transactional_email_transitions.count({
      where: { actor_id: actorId, occurred_at: { gte: new Date(Date.now() - 3_600_000) }, reason_code: "MANUAL_RETRY" },
    });
    if (attempts >= limitPerHour) return { email: null, reason: "RATE_LIMITED" };
    const email = await client.transactional_email_outbox.findUnique({ include: { sale_receipts: true }, where: { id: emailId } });
    if (!email) return { email: null, reason: "NOT_FOUND" };
    if (!["FAILED", "DEAD_LETTER"].includes(email.status)) return { email: mapEmail(email), reason: "NOT_RETRYABLE" };
    const result = await client.transactional_email_outbox.update({ data: {
      attempt_count: 0, last_error: null, last_error_code: null,
      next_attempt_at: new Date(), processing_finished_at: null,
      skip_reason: null, status: "PENDING",
    }, include: { sale_receipts: true }, where: { id: emailId } });
    await updateReceiptStatus(client, email.receipt_id, "PENDING");
    await transition(client, email, "PENDING", "MANUAL_RETRY", null, actorId);
    return { email: mapEmail(result), reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function recordTransactionalEmailProviderEvent(event) {
  return prisma.$transaction(async (client) => {
    const email = await client.transactional_email_outbox.findFirst({
      where: { provider: event.provider, provider_message_id: event.providerMessageId },
    });
    try {
      await client.transactional_email_provider_events.create({ data: {
        email_id: email?.id ?? null, event_data: event.eventData ?? {},
        event_type: event.eventType, occurred_at: event.occurredAt,
        payload_sha256: event.payloadSha256, provider: event.provider,
        provider_event_id: event.providerEventId, provider_message_id: event.providerMessageId,
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { duplicate: true, matched: Boolean(email) };
      }
      throw error;
    }
    const status = WEBHOOK_STATUSES[event.eventType];
    if (!email || !status || !FINAL_STATUSES.has(email.status)) return { duplicate: false, matched: Boolean(email) };
    await client.transactional_email_outbox.update({ data: {
      status, ...(status === "SUPPRESSED" ? { skip_reason: "PROVIDER_SUPPRESSED" } : {}),
    }, where: { id: email.id } });
    await updateReceiptStatus(client, email.receipt_id, status, email.provider_message_id);
    await transition(client, email, status, "PROVIDER_WEBHOOK");
    return { duplicate: false, matched: true };
  }, { isolationLevel: "Serializable" });
}
