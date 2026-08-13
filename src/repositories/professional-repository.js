import { executeQuery, executeTransaction } from "../db/query.js";

function mapProfessional(row) {
  if (!row) {
    return null;
  }

  return {
    appointmentDurationMinutes: row.appointment_duration_minutes,
    createdAt: row.created_at,
    email: row.email,
    firstName: row.first_name,
    id: row.user_id,
    isBookable: row.is_bookable,
    lastName: row.last_name,
    slotIntervalMinutes: row.slot_interval_minutes,
    updatedAt: row.updated_at,
  };
}

const PROFESSIONAL_SELECT = `
  SELECT
    professional_profiles.user_id,
    professional_profiles.appointment_duration_minutes,
    professional_profiles.slot_interval_minutes,
    professional_profiles.is_bookable,
    professional_profiles.created_at,
    professional_profiles.updated_at,
    users.email,
    users.first_name,
    users.last_name
  FROM professional_profiles
  JOIN users ON users.id = professional_profiles.user_id
`;

export async function createProfessionalProfile(profileData, actorUserId) {
  return executeTransaction(async (client) => {
    const clinicalUser = await client.query(
      `
        SELECT users.id
        FROM users
        JOIN user_roles ON user_roles.user_id = users.id
        JOIN roles ON roles.id = user_roles.role_id
        WHERE
          users.id = $1
          AND users.is_active = TRUE
          AND roles.code = 'CLINICAL_PROFESSIONAL'
        LIMIT 1
      `,
      [profileData.userId],
    );

    if (clinicalUser.rowCount === 0) {
      return null;
    }

    await client.query(
      `
        INSERT INTO professional_profiles (
          user_id,
          appointment_duration_minutes,
          slot_interval_minutes,
          is_bookable,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $5)
      `,
      [
        profileData.userId,
        profileData.appointmentDurationMinutes,
        profileData.slotIntervalMinutes,
        profileData.isBookable,
        actorUserId,
      ],
    );

    const result = await client.query(
      `${PROFESSIONAL_SELECT} WHERE professional_profiles.user_id = $1`,
      [profileData.userId],
    );

    return mapProfessional(result.rows[0]);
  });
}

export async function findProfessionalById(professionalId) {
  const result = await executeQuery(
    `${PROFESSIONAL_SELECT} WHERE professional_profiles.user_id = $1`,
    [professionalId],
  );

  return mapProfessional(result.rows[0]);
}

export async function listProfessionalProfiles() {
  const result = await executeQuery(`
    ${PROFESSIONAL_SELECT}
    ORDER BY users.last_name, users.first_name, users.id
  `);

  return result.rows.map(mapProfessional);
}

export async function updateProfessionalProfile(
  professionalId,
  profileData,
  actorUserId,
) {
  const result = await executeQuery(
    `
      UPDATE professional_profiles
      SET
        appointment_duration_minutes = $2,
        slot_interval_minutes = $3,
        is_bookable = $4,
        updated_by = $5
      WHERE user_id = $1
      RETURNING user_id
    `,
    [
      professionalId,
      profileData.appointmentDurationMinutes,
      profileData.slotIntervalMinutes,
      profileData.isBookable,
      actorUserId,
    ],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return findProfessionalById(professionalId);
}
