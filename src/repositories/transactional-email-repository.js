import { executeQuery, executeTransaction } from "../db/query.js";

function mapEmail(row) {
  if (!row) return null;
  return {
    attemptCount: Number(row.attempt_count),
    createdAt: row.created_at,
    deduplicationKey: row.deduplication_key,
    id: row.id,
    lastError: row.last_error,
    payload: row.payload,
    recipientEmail: row.recipient_email,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    status: row.status,
    templateCode: row.template_code,
    updatedAt: row.updated_at,
  };
}

export async function claimTransactionalEmail(deduplicationKey) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM transactional_email_outbox
       WHERE deduplication_key = $1 FOR UPDATE`,
      [deduplicationKey],
    );
    const email = mapEmail(result.rows[0]);
    if (!email) return { claimed: false, email: null, reason: "NOT_FOUND" };
    if (email.status === "SENT") {
      return { claimed: false, email, reason: "ALREADY_SENT" };
    }
    if (
      email.status === "SENDING"
      && new Date(email.updatedAt).getTime() > Date.now() - 5 * 60 * 1000
    ) {
      return { claimed: false, email, reason: "ALREADY_CLAIMED" };
    }
    if (new Date(email.scheduledAt).getTime() > Date.now()) {
      return { claimed: false, email, reason: "NOT_DUE" };
    }

    const claimed = await client.query(
      `UPDATE transactional_email_outbox
       SET status = 'SENDING', attempt_count = attempt_count + 1,
           last_error = NULL
       WHERE id = $1 RETURNING *`,
      [email.id],
    );
    return { claimed: true, email: mapEmail(claimed.rows[0]), reason: null };
  });
}

export async function markTransactionalEmailSent(emailId) {
  const result = await executeQuery(
    `UPDATE transactional_email_outbox
     SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, last_error = NULL
     WHERE id = $1 AND status = 'SENDING' RETURNING *`,
    [emailId],
  );
  return mapEmail(result.rows[0]);
}

export async function markTransactionalEmailFailed(emailId, error, attemptCount) {
  const retrySeconds = Math.min(60 * 60, 30 * (2 ** Math.min(attemptCount, 7)));
  const result = await executeQuery(
    `UPDATE transactional_email_outbox
     SET status = 'FAILED', last_error = $2,
         scheduled_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second')
     WHERE id = $1 AND status = 'SENDING' RETURNING *`,
    [emailId, error.slice(0, 1000), retrySeconds],
  );
  return mapEmail(result.rows[0]);
}

export async function listDuePaymentConfirmationKeys(limit = 25) {
  const result = await executeQuery(
    `SELECT deduplication_key
     FROM transactional_email_outbox
     WHERE template_code = 'PAYMENT_CONFIRMED'
       AND status IN ('PENDING', 'FAILED')
       AND scheduled_at <= CURRENT_TIMESTAMP
     ORDER BY scheduled_at, created_at
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => row.deduplication_key);
}
