import { PASSWORD_RECOVERY_SCOPES } from "../auth/password-recovery-token.js";
import { executeQuery, executeTransaction } from "../db/query.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

function assertScope(scope) {
  if (!Object.values(PASSWORD_RECOVERY_SCOPES).includes(scope)) {
    throw new TypeError("El ámbito de recuperación no es válido.");
  }
}

function mapTarget(row) {
  if (!row) return null;
  return { email: row.email, id: row.id };
}

async function findActiveTarget(client, scope, { email = null, id = null }, lock = false) {
  const suffix = lock ? " FOR UPDATE" : "";
  if (scope === PASSWORD_RECOVERY_SCOPES.INTERNAL_USER) {
    const result = await client.query(
      `SELECT users.id, users.email
       FROM users
       WHERE ${email == null ? "users.id = $1" : "users.email = $1"}
         AND users.is_active = TRUE
         AND EXISTS (
           SELECT 1
           FROM user_roles
           JOIN roles ON roles.id = user_roles.role_id
           WHERE user_roles.user_id = users.id
             AND roles.code IN ('ADMIN', 'CLINICAL_PROFESSIONAL', 'SALES')
         )${suffix}`,
      [email ?? id],
    );
    return mapTarget(result.rows[0]);
  }

  const result = await client.query(
    `SELECT customer_accounts.id, customer_accounts.email
     FROM customer_accounts
     WHERE ${email == null ? "customer_accounts.id = $1" : "customer_accounts.email = $1"}
       AND customer_accounts.is_active = TRUE${suffix}`,
    [email ?? id],
  );
  return mapTarget(result.rows[0]);
}

async function insertAudit(client, {
  event,
  metadata = {},
  requestId = null,
  scope,
}) {
  await client.query(
    `INSERT INTO password_recovery_audit (
       password_reset_request_id, scope, event, request_ip, request_user_agent
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      requestId,
      scope,
      event,
      metadata.ipAddress ?? null,
      metadata.userAgent?.slice(0, 512) ?? null,
    ],
  );
}

export async function findPasswordRecoveryTarget(scope, email) {
  assertScope(scope);
  return findActiveTarget(
    { query: (text, parameters) => executeQuery(text, parameters) },
    scope,
    { email },
  );
}

export async function recordPasswordRecoveryAudit(input) {
  assertScope(input.scope);
  await executeQuery(
    `INSERT INTO password_recovery_audit (
       password_reset_request_id, scope, event, request_ip, request_user_agent
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      input.requestId ?? null,
      input.scope,
      input.event,
      input.metadata?.ipAddress ?? null,
      input.metadata?.userAgent?.slice(0, 512) ?? null,
    ],
  );
}

export async function createPasswordRecoveryRequest({
  expiresAt,
  metadata = {},
  requestId,
  scope,
  target,
  tokenHash,
}) {
  assertScope(scope);
  return executeTransaction(async (client) => {
    const lockedTarget = await findActiveTarget(client, scope, { id: target.id }, true);
    if (!lockedTarget) {
      await insertAudit(client, { event: "REQUEST_IGNORED", metadata, scope });
      return null;
    }

    const targetColumn = scope === PASSWORD_RECOVERY_SCOPES.INTERNAL_USER
      ? "user_id"
      : "customer_account_id";
    await client.query(
      `UPDATE password_reset_requests
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE scope = $1
         AND ${targetColumn} = $2
         AND revoked_at IS NULL
         AND consumed_at IS NULL`,
      [scope, lockedTarget.id],
    );
    const result = await client.query(
      `INSERT INTO password_reset_requests (
         id, scope, user_id, customer_account_id, token_hash, expires_at,
         requested_ip, requested_user_agent
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8
       ) RETURNING id`,
      [
        requestId,
        scope,
        scope === PASSWORD_RECOVERY_SCOPES.INTERNAL_USER ? lockedTarget.id : null,
        scope === PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT ? lockedTarget.id : null,
        tokenHash,
        expiresAt,
        metadata.ipAddress ?? null,
        metadata.userAgent?.slice(0, 512) ?? null,
      ],
    );
    await client.query(
      `INSERT INTO transactional_email_outbox (
         template_code, recipient_email, payload, deduplication_key,
         account_id, password_reset_request_id
       ) VALUES ('PASSWORD_RECOVERY', $1, $2::JSONB, $3, $4, $5)`,
      [
        lockedTarget.email,
        JSON.stringify({ scope }),
        transactionalEmailDeduplicationKey("PASSWORD_RECOVERY", requestId),
        scope === PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT ? lockedTarget.id : null,
        result.rows[0].id,
      ],
    );
    await insertAudit(client, {
      event: "REQUEST_ACCEPTED",
      metadata,
      requestId: result.rows[0].id,
      scope,
    });
    return { id: result.rows[0].id };
  });
}

export async function consumePasswordRecoveryRequest({
  metadata = {},
  passwordHash,
  requestId,
  scope,
  tokenHash,
}) {
  assertScope(scope);
  return executeTransaction(async (client) => {
    const requestResult = await client.query(
      `SELECT *
       FROM password_reset_requests
       WHERE id = $1
         AND scope = $2
         AND token_hash = $3
         AND expires_at > CURRENT_TIMESTAMP
         AND revoked_at IS NULL
         AND consumed_at IS NULL
       FOR UPDATE`,
      [requestId, scope, tokenHash],
    );
    const request = requestResult.rows[0];
    if (!request) {
      await insertAudit(client, { event: "RESET_REJECTED", metadata, scope });
      return null;
    }

    const targetId = scope === PASSWORD_RECOVERY_SCOPES.INTERNAL_USER
      ? request.user_id
      : request.customer_account_id;
    const target = await findActiveTarget(client, scope, { id: targetId }, true);
    if (!target) {
      await insertAudit(client, {
        event: "RESET_REJECTED",
        metadata,
        requestId: request.id,
        scope,
      });
      return null;
    }

    if (scope === PASSWORD_RECOVERY_SCOPES.INTERNAL_USER) {
      await client.query(
        `UPDATE users
         SET password_hash = $2, password_changed_at = CURRENT_TIMESTAMP,
             failed_login_attempts = 0, locked_until = NULL
         WHERE id = $1`,
        [target.id, passwordHash],
      );
      await client.query(
        `UPDATE user_sessions
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [target.id],
      );
      await client.query(
        `UPDATE password_reset_requests
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE scope = $1 AND user_id = $2 AND id <> $3
           AND revoked_at IS NULL AND consumed_at IS NULL`,
        [scope, target.id, request.id],
      );
    } else {
      await client.query(
        `UPDATE customer_accounts
         SET password_hash = $2, password_changed_at = CURRENT_TIMESTAMP,
             failed_login_attempts = 0, locked_until = NULL
         WHERE id = $1`,
        [target.id, passwordHash],
      );
      await client.query(
        `UPDATE customer_account_sessions
         SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
         WHERE account_id = $1 AND revoked_at IS NULL`,
        [target.id],
      );
      await client.query(
        `UPDATE password_reset_requests
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE scope = $1 AND customer_account_id = $2 AND id <> $3
           AND revoked_at IS NULL AND consumed_at IS NULL`,
        [scope, target.id, request.id],
      );
    }

    await client.query(
      `UPDATE password_reset_requests
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [request.id],
    );
    await insertAudit(client, {
      event: "RESET_COMPLETED",
      metadata,
      requestId: request.id,
      scope,
    });
    return { id: request.id };
  });
}
