import { executeQuery, executeTransaction } from "../db/query.js";

export async function findActiveSessionByTokenHash(tokenHash) {
  const result = await executeQuery(
    `
      WITH active_session AS (
        UPDATE user_sessions
        SET last_used_at = CURRENT_TIMESTAMP
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        RETURNING id, user_id, expires_at
      )
      SELECT
        active_session.id AS session_id,
        active_session.user_id,
        active_session.expires_at,
        users.email,
        COALESCE(
          array_agg(DISTINCT roles.code)
            FILTER (WHERE roles.code IS NOT NULL),
          ARRAY[]::varchar[]
        ) AS roles,
        COALESCE(
          array_agg(DISTINCT permissions.code)
            FILTER (WHERE permissions.code IS NOT NULL),
          ARRAY[]::varchar[]
        ) AS permissions
      FROM active_session
      JOIN users ON users.id = active_session.user_id
      LEFT JOIN user_roles ON user_roles.user_id = users.id
      LEFT JOIN roles ON roles.id = user_roles.role_id
      LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
      LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
      WHERE users.is_active = TRUE
        AND (users.locked_until IS NULL OR users.locked_until <= CURRENT_TIMESTAMP)
      GROUP BY
        active_session.id,
        active_session.user_id,
        active_session.expires_at,
        users.email
    `,
    [tokenHash],
  );

  const session = result.rows[0];

  if (!session) {
    return null;
  }

  return {
    email: session.email,
    expiresAt: session.expires_at,
    permissions: session.permissions,
    roles: session.roles,
    sessionId: session.session_id,
    userId: session.user_id,
  };
}

export async function createSessionForSuccessfulLogin({
  expiresAt,
  ipAddress,
  tokenHash,
  userAgent,
  userId,
}) {
  return executeTransaction(async (client) => {
    await client.query(
      `
        UPDATE users
        SET
          failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [userId],
    );

    const result = await client.query(
      `
        INSERT INTO user_sessions (
          user_id,
          token_hash,
          expires_at,
          created_ip,
          user_agent
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, expires_at
      `,
      [userId, tokenHash, expiresAt, ipAddress, userAgent],
    );

    return {
      expiresAt: result.rows[0].expires_at,
      id: result.rows[0].id,
    };
  });
}

export async function revokeSession(sessionId, userId) {
  const result = await executeQuery(
    `
      UPDATE user_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `,
    [sessionId, userId],
  );

  return result.rowCount > 0;
}
