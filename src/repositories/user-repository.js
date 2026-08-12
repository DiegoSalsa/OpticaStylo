import { executeTransaction } from "../db/query.js";

export async function createUserWithRoles(userData, assignedBy) {
  return executeTransaction(async (client) => {
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
  });
}
