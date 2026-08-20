import { executeQuery, executeTransaction } from "../db/query.js";

const BOOTSTRAP_ADMIN_LOCK_ID = 743_205_118;

function mapUser(row) {
  if (!row) return null;
  return {
    createdAt: row.created_at,
    email: row.email,
    firstName: row.first_name,
    id: row.id,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    lastName: row.last_name,
    roles: row.roles,
  };
}

async function findUserByIdWithClient(client, userId, { lock = false } = {}) {
  if (lock) {
    const locked = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (locked.rowCount === 0) return null;
  }
  const result = await client.query(
    `SELECT users.id, users.email, users.first_name, users.last_name,
            users.is_active, users.last_login_at, users.created_at,
            COALESCE(array_agg(roles.code ORDER BY roles.code)
              FILTER (WHERE roles.code IS NOT NULL), ARRAY[]::varchar[]) AS roles
     FROM users
     LEFT JOIN user_roles ON user_roles.user_id = users.id
     LEFT JOIN roles ON roles.id = user_roles.role_id
     WHERE users.id = $1
     GROUP BY users.id`,
    [userId],
  );
  return mapUser(result.rows[0]);
}

async function insertUserWithRoles(client, userData, assignedBy) {
  const rolesResult = await client.query(
    `
      SELECT id, code
      FROM roles
      WHERE code = ANY($1::text[])
      ORDER BY code
    `,
    [userData.roles],
  );

  if (rolesResult.rows.length !== userData.roles.length) {
    return null;
  }

  const userResult = await client.query(
    `
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, first_name, last_name, is_active, created_at
    `,
    [
      userData.email,
      userData.passwordHash,
      userData.firstName,
      userData.lastName,
    ],
  );
  const user = userResult.rows[0];

  await client.query(
    `
      INSERT INTO user_roles (user_id, role_id, assigned_by)
      SELECT $1, id, $2
      FROM roles
      WHERE code = ANY($3::text[])
    `,
    [user.id, assignedBy, userData.roles],
  );

  return {
    createdAt: user.created_at,
    email: user.email,
    firstName: user.first_name,
    id: user.id,
    isActive: user.is_active,
    lastName: user.last_name,
    roles: rolesResult.rows.map((role) => role.code),
  };
}

export async function createUserWithRoles(userData, assignedBy) {
  return executeTransaction(async (client) => {
    return insertUserWithRoles(client, userData, assignedBy);
  });
}

export async function listUsers({ page, pageSize, search }) {
  const offset = (page - 1) * pageSize;
  const pattern = `%${search}%`;
  const filters = `$1 = '' OR users.email ILIKE $2 OR users.first_name ILIKE $2
    OR users.last_name ILIKE $2 OR concat_ws(' ', users.first_name, users.last_name) ILIKE $2`;
  const parameters = [search, pattern];
  const [itemsResult, countResult] = await Promise.all([
    executeQuery(
      `SELECT users.id, users.email, users.first_name, users.last_name,
              users.is_active, users.last_login_at, users.created_at,
              COALESCE(array_agg(roles.code ORDER BY roles.code)
                FILTER (WHERE roles.code IS NOT NULL), ARRAY[]::varchar[]) AS roles
       FROM users
       LEFT JOIN user_roles ON user_roles.user_id = users.id
       LEFT JOIN roles ON roles.id = user_roles.role_id
       WHERE ${filters}
       GROUP BY users.id
       ORDER BY users.is_active DESC, users.last_name, users.first_name
       LIMIT $3 OFFSET $4`,
      [...parameters, pageSize, offset],
    ),
    executeQuery(`SELECT COUNT(*) AS total FROM users WHERE ${filters}`, parameters),
  ]);
  const total = Number(countResult.rows[0].total);
  return {
    items: itemsResult.rows.map((user) => ({
      createdAt: user.created_at,
      email: user.email,
      firstName: user.first_name,
      id: user.id,
      isActive: user.is_active,
      lastLoginAt: user.last_login_at,
      lastName: user.last_name,
      roles: user.roles,
    })),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export async function findUserById(userId) {
  return findUserByIdWithClient(
    { query: (text, parameters) => executeQuery(text, parameters) },
    userId,
  );
}

export async function updateUserWithRoles(userId, userData, actorUserId) {
  return executeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_ADMIN_LOCK_ID]);
    const current = await findUserByIdWithClient(client, userId, { lock: true });
    if (!current) return { reason: "USER_NOT_FOUND", user: null };

    const removesActiveAdmin = current.isActive
      && current.roles.includes("ADMIN")
      && (!userData.isActive || !userData.roles.includes("ADMIN"));
    if (removesActiveAdmin) {
      const result = await client.query(
        `SELECT COUNT(DISTINCT users.id) AS total
         FROM users
         INNER JOIN user_roles ON user_roles.user_id = users.id
         INNER JOIN roles ON roles.id = user_roles.role_id
         WHERE users.is_active = TRUE AND roles.code = 'ADMIN'`,
      );
      if (Number(result.rows[0].total) <= 1) {
        return { reason: "LAST_ACTIVE_ADMIN", user: null };
      }
    }

    const roles = await client.query(
      "SELECT id, code FROM roles WHERE code = ANY($1::text[]) ORDER BY code",
      [userData.roles],
    );
    if (roles.rows.length !== userData.roles.length) {
      return { reason: "INVALID_USER_ROLES", user: null };
    }

    await client.query(
      `UPDATE users
       SET email = $2, first_name = $3, last_name = $4, is_active = $5,
           password_hash = COALESCE($6, password_hash),
           password_changed_at = CASE WHEN $6 IS NULL THEN password_changed_at ELSE CURRENT_TIMESTAMP END
       WHERE id = $1`,
      [
        userId,
        userData.email,
        userData.firstName,
        userData.lastName,
        userData.isActive,
        userData.passwordHash,
      ],
    );
    await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       SELECT $1, id, $2 FROM roles WHERE code = ANY($3::text[])`,
      [userId, actorUserId, userData.roles],
    );
    if (userData.revokeSessions) {
      await client.query(
        `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    }
    return {
      reason: null,
      user: await findUserByIdWithClient(client, userId),
    };
  });
}

export async function createInitialAdmin(userData) {
  return executeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      BOOTSTRAP_ADMIN_LOCK_ID,
    ]);
    const usersResult = await client.query("SELECT EXISTS (SELECT 1 FROM users)");

    if (usersResult.rows[0].exists) {
      return null;
    }

    return insertUserWithRoles(client, userData, null);
  });
}

export async function findUserForAuthentication(email) {
  const result = await executeQuery(
    `
      SELECT
        users.id,
        users.email,
        users.password_hash,
        users.first_name,
        users.last_name,
        users.is_active,
        users.failed_login_attempts,
        users.locked_until,
        COALESCE(
          array_agg(roles.code ORDER BY roles.code)
            FILTER (WHERE roles.code IS NOT NULL),
          ARRAY[]::varchar[]
        ) AS roles
      FROM users
      LEFT JOIN user_roles ON user_roles.user_id = users.id
      LEFT JOIN roles ON roles.id = user_roles.role_id
      WHERE users.email = $1
      GROUP BY users.id
    `,
    [email],
  );
  const user = result.rows[0] ?? null;

  if (!user) {
    return null;
  }

  return {
    email: user.email,
    failedLoginAttempts: user.failed_login_attempts,
    firstName: user.first_name,
    id: user.id,
    isActive: user.is_active,
    lastName: user.last_name,
    lockedUntil: user.locked_until,
    passwordHash: user.password_hash,
    roles: user.roles,
  };
}

export async function recordFailedLogin(userId, maximumAttempts, lockMinutes) {
  await executeTransaction(async (client) => {
    await client.query(
      `
        UPDATE users
        SET
          failed_login_attempts = LEAST(
            CASE
              WHEN locked_until IS NOT NULL
                AND locked_until <= CURRENT_TIMESTAMP
                THEN 1
              ELSE failed_login_attempts + 1
            END,
            $2
          ),
          locked_until = CASE
            WHEN (
              CASE
                WHEN locked_until IS NOT NULL
                  AND locked_until <= CURRENT_TIMESTAMP
                  THEN 1
                ELSE failed_login_attempts + 1
              END
            ) >= $2
              THEN CURRENT_TIMESTAMP + make_interval(mins => $3)
            ELSE NULL
          END
        WHERE id = $1
      `,
      [userId, maximumAttempts, lockMinutes],
    );
  });
}
