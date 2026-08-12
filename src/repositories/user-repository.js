import { executeQuery, executeTransaction } from "../db/query.js";

const BOOTSTRAP_ADMIN_LOCK_ID = 743_205_118;

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
