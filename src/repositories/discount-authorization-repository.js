import { executeTransaction } from "../db/query.js";

const MAXIMUM_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export async function beginDiscountAuthorizationAttempt({
  attemptedBy,
  authorizerEmail,
  maximumAttempts = MAXIMUM_ATTEMPTS,
  windowMinutes = WINDOW_MINUTES,
}) {
  return executeTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`discount-actor:${attemptedBy}`],
    );
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`discount-email:${authorizerEmail}`],
    );

    const recentResult = await client.query(
      `SELECT COUNT(*) AS total
       FROM discount_authorization_attempts
       WHERE status IN ('PENDING', 'FAILED')
         AND attempted_at >= CURRENT_TIMESTAMP - make_interval(mins => $3)
         AND (attempted_by = $1 OR authorizer_email = $2)`,
      [attemptedBy, authorizerEmail, windowMinutes],
    );
    const allowed = Number(recentResult.rows[0].total) < maximumAttempts;
    const result = await client.query(
      `INSERT INTO discount_authorization_attempts (
         attempted_by, authorizer_email, status, completed_at
       ) VALUES (
         $1, $2, $3, CASE WHEN $3 = 'RATE_LIMITED' THEN CURRENT_TIMESTAMP ELSE NULL END
       ) RETURNING id`,
      [attemptedBy, authorizerEmail, allowed ? "PENDING" : "RATE_LIMITED"],
    );
    return { allowed, attemptId: result.rows[0].id };
  });
}

export async function completeDiscountAuthorizationAttempt(
  attemptId,
  { authorizerUserId = null, succeeded },
) {
  await executeTransaction(async (client) => {
    const result = await client.query(
      `UPDATE discount_authorization_attempts
       SET authorizer_user_id = $2,
           status = $3,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PENDING'`,
      [attemptId, authorizerUserId, succeeded ? "SUCCEEDED" : "FAILED"],
    );
    if (result.rowCount !== 1) {
      throw new Error("El intento de autorización de descuento ya no está vigente.");
    }
  });
}
