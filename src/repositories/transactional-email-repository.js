import { executeQuery, executeTransaction } from "../db/query.js";

const FINAL_STATUSES = new Set([
  "SENT", "TEST_SENT", "SIMULATED", "DEAD_LETTER", "DELIVERED",
  "BOUNCED", "COMPLAINED", "SUPPRESSED",
]);
const WEBHOOK_STATUSES = Object.freeze({
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.delivered": "DELIVERED",
  "email.failed": "DEAD_LETTER",
  "email.suppressed": "SUPPRESSED",
});

function numberOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function mapEmail(row) {
  if (!row) return null;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return {
    accountId: row.account_id,
    appointmentId: row.appointment_id,
    attemptCount: Number(row.attempt_count),
    createdAt: row.created_at,
    deduplicationKey: row.deduplication_key,
    deliveryMode: row.delivery_mode,
    effectiveRecipientEmail: row.effective_recipient_email,
    id: row.id,
    lastError: row.last_error,
    lastErrorCode: row.last_error_code,
    lockExpiresAt: row.lock_expires_at,
    lockedBy: row.locked_by,
    nextAttemptAt: row.next_attempt_at,
    paymentId: row.payment_id,
    payload: {
      ...payload,
      ...(row.receipt_number == null ? {} : {
        balanceCents: numberOrNull(row.receipt_balance_cents),
        paidCents: numberOrNull(row.receipt_paid_cents),
        receiptNumber: Number(row.receipt_number),
        saleNumber: numberOrNull(row.receipt_sale_number),
        totalCents: numberOrNull(row.receipt_total_cents),
      }),
    },
    processingFinishedAt: row.processing_finished_at,
    processingStartedAt: row.processing_started_at,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    receiptId: row.receipt_id,
    recipientEmail: row.recipient_email,
    saleId: row.sale_id,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    skipReason: row.skip_reason,
    status: row.status,
    templateCode: row.template_code,
    updatedAt: row.updated_at,
  };
}

async function transition(client, email, toStatus, reasonCode, errorCode = null, actorId = null) {
  await client.query(
    `INSERT INTO transactional_email_transitions (
       email_id, from_status, to_status, reason_code, error_code,
       attempt_count, actor_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [email.id, email.status, toStatus, reasonCode, errorCode,
      Number(email.attempt_count), actorId],
  );
}

async function updateReceiptStatus(client, receiptId, status, providerId = null, error = null) {
  if (!receiptId) return;
  await client.query(
    `UPDATE sale_receipts
     SET email_status = $2, email_provider_id = $3, email_error = $4,
         email_updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [receiptId, status, providerId, error],
  );
}

async function recoverExpiredLocks(client, limit) {
  const result = await client.query(
    `SELECT * FROM transactional_email_outbox
     WHERE status = 'PROCESSING' AND lock_expires_at <= CURRENT_TIMESTAMP
     ORDER BY lock_expires_at, id
     FOR UPDATE SKIP LOCKED
     LIMIT $1`,
    [limit],
  );
  for (const email of result.rows) {
    await client.query(
      `UPDATE transactional_email_outbox
       SET status = 'FAILED', next_attempt_at = CURRENT_TIMESTAMP,
           processing_finished_at = CURRENT_TIMESTAMP,
           locked_at = NULL, lock_expires_at = NULL, locked_by = NULL,
           last_error_code = 'worker_abandoned',
           last_error = 'El trabajador anterior no finalizó el procesamiento.'
       WHERE id = $1`,
      [email.id],
    );
    await updateReceiptStatus(
      client,
      email.receipt_id,
      "FAILED",
      null,
      "El trabajador anterior no finalizó el procesamiento.",
    );
    await transition(client, email, "FAILED", "EXPIRED_LOCK_RECOVERED", "worker_abandoned");
  }
  return result.rowCount;
}

export async function claimTransactionalEmailBatch({
  deliveryMode,
  effectiveTestRecipient = null,
  limit,
  lockSeconds,
  workerId,
}) {
  return executeTransaction(async (client) => {
    const recoveredCount = await recoverExpiredLocks(client, limit);
    const result = await client.query(
      `SELECT outbox.*,
              receipts.receipt_number,
              receipts.payload ->> 'balanceCents' AS receipt_balance_cents,
              receipts.payload ->> 'paidCents' AS receipt_paid_cents,
              receipts.payload ->> 'saleNumber' AS receipt_sale_number,
              receipts.payload ->> 'totalCents' AS receipt_total_cents
       FROM transactional_email_outbox AS outbox
       LEFT JOIN sale_receipts AS receipts ON receipts.id = outbox.receipt_id
       WHERE outbox.status IN ('PENDING', 'FAILED')
         AND outbox.next_attempt_at <= CURRENT_TIMESTAMP
       ORDER BY outbox.next_attempt_at, outbox.created_at, outbox.id
       FOR UPDATE OF outbox SKIP LOCKED
       LIMIT $1`,
      [limit],
    );
    const claimed = [];
    for (const row of result.rows) {
      const effectiveRecipient = deliveryMode === "test"
        ? effectiveTestRecipient
        : deliveryMode === "live"
          ? row.recipient_email
          : null;
      const updated = await client.query(
        `UPDATE transactional_email_outbox
         SET status = 'PROCESSING', attempt_count = attempt_count + 1,
             processing_started_at = CURRENT_TIMESTAMP,
             processing_finished_at = NULL,
             locked_at = CURRENT_TIMESTAMP,
             lock_expires_at = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),
             locked_by = $3, delivery_mode = $4,
             effective_recipient_email = $5,
             last_error = NULL, last_error_code = NULL, skip_reason = NULL
         WHERE id = $1 RETURNING *`,
        [row.id, lockSeconds, workerId, deliveryMode, effectiveRecipient],
      );
      const current = updated.rows[0];
      await updateReceiptStatus(client, current.receipt_id, "PROCESSING");
      await transition(client, { ...row, attempt_count: current.attempt_count },
        "PROCESSING", "WORKER_CLAIMED");
      claimed.push(mapEmail({ ...row, ...current }));
    }
    return { emails: claimed, recoveredCount };
  });
}

export async function completeTransactionalEmail(
  emailId,
  workerId,
  { effectiveRecipientEmail = null, provider = null, providerMessageId = null, status },
) {
  return executeTransaction(async (client) => {
    const locked = await client.query(
      `SELECT * FROM transactional_email_outbox
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2
       FOR UPDATE`,
      [emailId, workerId],
    );
    const email = locked.rows[0];
    if (!email) return null;
    const sentAt = ["SENT", "TEST_SENT"].includes(status) ? new Date() : null;
    const result = await client.query(
      `UPDATE transactional_email_outbox
       SET status = $3, provider = $4, provider_message_id = $5,
           effective_recipient_email = $6, sent_at = $7,
           processing_finished_at = CURRENT_TIMESTAMP,
           locked_at = NULL, lock_expires_at = NULL, locked_by = NULL,
           last_error = NULL, last_error_code = NULL
       WHERE id = $1 AND locked_by = $2 RETURNING *`,
      [emailId, workerId, status, provider, providerMessageId,
        effectiveRecipientEmail, sentAt],
    );
    await updateReceiptStatus(client, email.receipt_id, status, providerMessageId);
    await transition(client, email, status,
      status === "SIMULATED" ? "SIMULATION_COMPLETED" : "PROVIDER_ACCEPTED");
    if (provider && providerMessageId) {
      await client.query(
        `UPDATE transactional_email_provider_events
         SET email_id = $1
         WHERE provider = $2 AND provider_message_id = $3 AND email_id IS NULL`,
        [emailId, provider, providerMessageId],
      );
      const pendingEvent = await client.query(
        `SELECT event_type FROM transactional_email_provider_events
         WHERE email_id = $1
           AND event_type IN (
             'email.delivered', 'email.bounced', 'email.complained',
             'email.suppressed', 'email.failed'
           )
         ORDER BY COALESCE(occurred_at, received_at) DESC, received_at DESC
         LIMIT 1`,
        [emailId],
      );
      const webhookStatus = WEBHOOK_STATUSES[pendingEvent.rows[0]?.event_type];
      if (webhookStatus) {
        await client.query(
          `UPDATE transactional_email_outbox SET status = $2 WHERE id = $1`,
          [emailId, webhookStatus],
        );
        await updateReceiptStatus(
          client,
          email.receipt_id,
          webhookStatus,
          providerMessageId,
        );
        await transition(
          client,
          { ...email, status },
          webhookStatus,
          "EARLY_PROVIDER_WEBHOOK",
        );
        result.rows[0].status = webhookStatus;
      }
    }
    return mapEmail(result.rows[0]);
  });
}

export async function failTransactionalEmail(
  emailId,
  workerId,
  { errorCode, maxAttempts, nextAttemptAt, permanent },
) {
  return executeTransaction(async (client) => {
    const locked = await client.query(
      `SELECT * FROM transactional_email_outbox
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2
       FOR UPDATE`,
      [emailId, workerId],
    );
    const email = locked.rows[0];
    if (!email) return null;
    const status = permanent || Number(email.attempt_count) >= maxAttempts
      ? "DEAD_LETTER"
      : "FAILED";
    const safeMessage = status === "DEAD_LETTER"
      ? "El mensaje requiere revisión administrativa."
      : "El mensaje se reintentará después de un error temporal.";
    const result = await client.query(
      `UPDATE transactional_email_outbox
       SET status = $3, next_attempt_at = $4,
           processing_finished_at = CURRENT_TIMESTAMP,
           locked_at = NULL, lock_expires_at = NULL, locked_by = NULL,
           last_error_code = $5, last_error = $6
       WHERE id = $1 AND locked_by = $2 RETURNING *`,
      [emailId, workerId, status, nextAttemptAt, errorCode, safeMessage],
    );
    await updateReceiptStatus(client, email.receipt_id, status, null, safeMessage);
    await transition(client, email, status,
      status === "DEAD_LETTER" ? "RETRY_EXHAUSTED_OR_PERMANENT" : "RETRY_SCHEDULED",
      errorCode);
    return mapEmail(result.rows[0]);
  });
}

export async function suppressTransactionalEmail(emailId, workerId, reasonCode) {
  return executeTransaction(async (client) => {
    const locked = await client.query(
      `SELECT * FROM transactional_email_outbox
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2
       FOR UPDATE`,
      [emailId, workerId],
    );
    const email = locked.rows[0];
    if (!email) return null;
    const result = await client.query(
      `UPDATE transactional_email_outbox
       SET status = 'SUPPRESSED', skip_reason = $3,
           processing_finished_at = CURRENT_TIMESTAMP,
           locked_at = NULL, lock_expires_at = NULL, locked_by = NULL
       WHERE id = $1 AND locked_by = $2 RETURNING *`,
      [emailId, workerId, reasonCode],
    );
    await updateReceiptStatus(client, email.receipt_id, "SUPPRESSED", null, reasonCode);
    await transition(client, email, "SUPPRESSED", reasonCode);
    return mapEmail(result.rows[0]);
  });
}

export async function getAppointmentReminderEligibility(email) {
  if (email.templateCode !== "APPOINTMENT_REMINDER" || !email.appointmentId) {
    return { eligible: true, reason: null };
  }
  const result = await executeQuery(
    `SELECT status, start_at FROM appointments WHERE id = $1`,
    [email.appointmentId],
  );
  const appointment = result.rows[0];
  if (!appointment) return { eligible: false, reason: "APPOINTMENT_NOT_FOUND" };
  if (appointment.status !== "CONFIRMED") {
    return { eligible: false, reason: `APPOINTMENT_${appointment.status}`.slice(0, 80) };
  }
  if (new Date(appointment.start_at).getTime() <= Date.now()) {
    return { eligible: false, reason: "APPOINTMENT_ALREADY_STARTED" };
  }
  return { eligible: true, reason: null };
}

export async function findRecipientSuppression(emailId, recipientEmail) {
  const result = await executeQuery(
    `SELECT status FROM transactional_email_outbox
     WHERE id <> $1 AND recipient_email = $2 AND delivery_mode = 'live'
       AND status IN ('BOUNCED', 'COMPLAINED', 'SUPPRESSED')
     ORDER BY updated_at DESC LIMIT 1`,
    [emailId, recipientEmail],
  );
  return result.rows[0]?.status ?? null;
}

export async function startTransactionalEmailWorkerRun({ deliveryMode, triggerSource, workerId }) {
  const result = await executeQuery(
    `INSERT INTO transactional_email_worker_runs (
       worker_id, trigger_source, delivery_mode
     ) VALUES ($1, $2, $3) RETURNING id`,
    [workerId, triggerSource, deliveryMode],
  );
  return result.rows[0].id;
}

export async function finishTransactionalEmailWorkerRun(runId, summary) {
  await executeQuery(
    `UPDATE transactional_email_worker_runs
     SET status = $2, claimed_count = $3, sent_count = $4,
         simulated_count = $5, failed_count = $6,
         dead_letter_count = $7, recovered_count = $8,
         finished_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [runId, summary.status, summary.claimed, summary.sent, summary.simulated,
      summary.failed, summary.deadLetter, summary.recovered],
  );
}

export async function getTransactionalEmailMetrics() {
  const result = await executeQuery(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
       COUNT(*) FILTER (WHERE status = 'PROCESSING') AS processing,
       COUNT(*) FILTER (WHERE status IN ('SENT', 'TEST_SENT', 'DELIVERED')) AS sent,
       COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
       COUNT(*) FILTER (WHERE status = 'DEAD_LETTER') AS dead_letter,
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at)
         FILTER (WHERE status IN ('PENDING', 'FAILED')))) AS oldest_pending_seconds,
       (SELECT MAX(finished_at) FROM transactional_email_worker_runs
        WHERE status = 'SUCCESS') AS last_successful_run_at
     FROM transactional_email_outbox`,
  );
  const row = result.rows[0];
  return {
    deadLetter: Number(row.dead_letter),
    failed: Number(row.failed),
    lastSuccessfulRunAt: row.last_successful_run_at,
    oldestPendingSeconds: row.oldest_pending_seconds == null
      ? null
      : Math.max(0, Math.floor(Number(row.oldest_pending_seconds))),
    pending: Number(row.pending),
    processing: Number(row.processing),
    sent: Number(row.sent),
  };
}

export async function retryTransactionalEmail(emailId, actorId, limitPerHour = 10) {
  return executeTransaction(async (client) => {
    const attempts = await client.query(
      `SELECT COUNT(*) AS count FROM transactional_email_transitions
       WHERE actor_id = $1 AND reason_code = 'MANUAL_RETRY'
         AND occurred_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
      [actorId],
    );
    if (Number(attempts.rows[0].count) >= limitPerHour) {
      return { email: null, reason: "RATE_LIMITED" };
    }
    const locked = await client.query(
      `SELECT * FROM transactional_email_outbox WHERE id = $1 FOR UPDATE`,
      [emailId],
    );
    const email = locked.rows[0];
    if (!email) return { email: null, reason: "NOT_FOUND" };
    if (!["FAILED", "DEAD_LETTER"].includes(email.status)) {
      return { email: mapEmail(email), reason: "NOT_RETRYABLE" };
    }
    const result = await client.query(
      `UPDATE transactional_email_outbox
       SET status = 'PENDING', attempt_count = 0,
           next_attempt_at = CURRENT_TIMESTAMP, last_error = NULL,
           last_error_code = NULL, processing_finished_at = NULL,
           skip_reason = NULL
       WHERE id = $1 RETURNING *`,
      [emailId],
    );
    await updateReceiptStatus(client, email.receipt_id, "PENDING");
    await transition(client, email, "PENDING", "MANUAL_RETRY", null, actorId);
    return { email: mapEmail(result.rows[0]), reason: null };
  });
}

export async function recordTransactionalEmailProviderEvent(event) {
  return executeTransaction(async (client) => {
    const message = await client.query(
      `SELECT * FROM transactional_email_outbox
       WHERE provider = $1 AND provider_message_id = $2
       FOR UPDATE`,
      [event.provider, event.providerMessageId],
    );
    const email = message.rows[0] ?? null;
    const inserted = await client.query(
      `INSERT INTO transactional_email_provider_events (
         provider, provider_event_id, event_type, provider_message_id,
         email_id, occurred_at, payload_sha256, event_data
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [event.provider, event.providerEventId, event.eventType,
        event.providerMessageId, email?.id ?? null, event.occurredAt,
        event.payloadSha256, JSON.stringify(event.eventData ?? {})],
    );
    if (inserted.rowCount === 0) return { duplicate: true, matched: Boolean(email) };
    const status = WEBHOOK_STATUSES[event.eventType];
    if (!email || !status || !FINAL_STATUSES.has(email.status)) {
      return { duplicate: false, matched: Boolean(email) };
    }
    await client.query(
      `UPDATE transactional_email_outbox
       SET status = $2, skip_reason = CASE WHEN $2 = 'SUPPRESSED'
         THEN 'PROVIDER_SUPPRESSED' ELSE skip_reason END
       WHERE id = $1`,
      [email.id, status],
    );
    await updateReceiptStatus(client, email.receipt_id, status, email.provider_message_id);
    await transition(client, email, status, "PROVIDER_WEBHOOK");
    return { duplicate: false, matched: true };
  });
}
