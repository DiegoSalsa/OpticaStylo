import { executeQuery, executeTransaction } from "../db/query.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

function mapAccount(row) {
  if (!row) return null;
  return {
    address: row.address,
    customerId: row.customer_id,
    email: row.email,
    failedLoginAttempts: row.failed_login_attempts,
    firstNames: row.first_names,
    id: row.id,
    isActive: row.is_active,
    lastNames: row.last_names,
    lockedUntil: row.locked_until,
    passwordHash: row.password_hash,
    phone: row.phone,
    rut: row.rut,
  };
}

export async function createCustomerAccount(account) {
  return executeTransaction(async (client) => {
    const customerResult = await client.query(
      `INSERT INTO customers (
         rut, first_names, last_names, phone, email, address, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
       RETURNING id`,
      [account.rut, account.firstNames, account.lastNames, account.phone,
        account.email, account.address],
    );
    const result = await client.query(
      `INSERT INTO customer_accounts (customer_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [customerResult.rows[0].id, account.email, account.passwordHash],
    );
    await client.query(
      `INSERT INTO transactional_email_outbox (
         template_code, recipient_email, payload, deduplication_key, account_id
       ) VALUES ('ACCOUNT_CREATED', $1, $2::JSONB, $3, $4)
       ON CONFLICT (deduplication_key) DO NOTHING`,
      [account.email, JSON.stringify({ firstNames: account.firstNames }),
        transactionalEmailDeduplicationKey("ACCOUNT_CREATED", result.rows[0].id),
        result.rows[0].id],
    );
    return mapAccount({
      ...result.rows[0],
      address: account.address,
      first_names: account.firstNames,
      last_names: account.lastNames,
      phone: account.phone,
      rut: account.rut,
    });
  });
}

export async function findCustomerAccountForAuthentication(email) {
  const result = await executeQuery(
    `SELECT customer_accounts.*, customers.rut, customers.first_names,
            customers.last_names, customers.phone, customers.address
     FROM customer_accounts
     JOIN customers ON customers.id = customer_accounts.customer_id
     WHERE customer_accounts.email = $1`,
    [email],
  );
  return mapAccount(result.rows[0]);
}

export async function recordCustomerFailedLogin(accountId, maximumAttempts, lockMinutes) {
  await executeQuery(
    `UPDATE customer_accounts
     SET failed_login_attempts = LEAST(failed_login_attempts + 1, $2),
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2
             THEN CURRENT_TIMESTAMP + make_interval(mins => $3)
           ELSE locked_until
         END
     WHERE id = $1`,
    [accountId, maximumAttempts, lockMinutes],
  );
}

export async function createCustomerSession({
  accountId,
  expiresAt,
  ipAddress,
  tokenHash,
  userAgent,
}) {
  return executeTransaction(async (client) => {
    await client.query(
      `UPDATE customer_accounts
       SET failed_login_attempts = 0, locked_until = NULL,
           last_login_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [accountId],
    );
    const result = await client.query(
      `INSERT INTO customer_account_sessions (
         account_id, token_hash, expires_at, created_ip, user_agent
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, expires_at`,
      [accountId, tokenHash, expiresAt, ipAddress, userAgent],
    );
    return { expiresAt: result.rows[0].expires_at, id: result.rows[0].id };
  });
}

export async function findActiveCustomerSession(tokenHash) {
  const result = await executeQuery(
    `WITH active_session AS (
       UPDATE customer_account_sessions
       SET last_used_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       RETURNING id, account_id, expires_at
     )
     SELECT active_session.id AS session_id, active_session.expires_at,
            customer_accounts.id, customer_accounts.customer_id,
            customer_accounts.email, customers.rut, customers.first_names,
            customers.last_names, customers.phone, customers.address
     FROM active_session
     JOIN customer_accounts ON customer_accounts.id = active_session.account_id
     JOIN customers ON customers.id = customer_accounts.customer_id
     WHERE customer_accounts.is_active = TRUE
       AND (customer_accounts.locked_until IS NULL
            OR customer_accounts.locked_until <= CURRENT_TIMESTAMP)`,
    [tokenHash],
  );
  const account = mapAccount(result.rows[0]);
  return account
    ? { ...account, expiresAt: result.rows[0].expires_at, sessionId: result.rows[0].session_id }
    : null;
}

export async function revokeCustomerSession(sessionId, accountId) {
  const result = await executeQuery(
    `UPDATE customer_account_sessions
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
     WHERE id = $1 AND account_id = $2 RETURNING id`,
    [sessionId, accountId],
  );
  return result.rowCount > 0;
}
