import { executeQuery, executeTransaction } from "../db/query.js";

function mapPatient(row) {
  if (!row) {
    return null;
  }

  return {
    address: row.address,
    birthDate: row.birth_date,
    createdAt: row.created_at,
    email: row.email,
    firstNames: row.first_names,
    guardian: row.guardian,
    id: row.id,
    lastNames: row.last_names,
    phone: row.phone,
    rut: row.rut,
    updatedAt: row.updated_at,
  };
}

async function findPatientByIdWithClient(client, patientId) {
  const result = await client.query(
    `
      SELECT
        patients.id,
        patients.rut,
        patients.first_names,
        patients.last_names,
        patients.birth_date,
        patients.phone,
        patients.email,
        patients.address,
        patients.created_at,
        patients.updated_at,
        CASE
          WHEN patient_guardians.id IS NULL THEN NULL
          ELSE json_build_object(
            'id', patient_guardians.id,
            'rut', patient_guardians.rut,
            'firstNames', patient_guardians.first_names,
            'lastNames', patient_guardians.last_names,
            'relationship', patient_guardians.relationship,
            'phone', patient_guardians.phone,
            'email', patient_guardians.email
          )
        END AS guardian
      FROM patients
      LEFT JOIN patient_guardians
        ON patient_guardians.patient_id = patients.id
      WHERE patients.id = $1
    `,
    [patientId],
  );

  return mapPatient(result.rows[0]);
}

async function upsertGuardian(client, patientId, guardian) {
  if (!guardian) {
    return;
  }

  await client.query(
    `
      INSERT INTO patient_guardians (
        patient_id,
        rut,
        first_names,
        last_names,
        relationship,
        phone,
        email
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (patient_id) DO UPDATE
      SET
        rut = EXCLUDED.rut,
        first_names = EXCLUDED.first_names,
        last_names = EXCLUDED.last_names,
        relationship = EXCLUDED.relationship,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email
    `,
    [
      patientId,
      guardian.rut,
      guardian.firstNames,
      guardian.lastNames,
      guardian.relationship,
      guardian.phone,
      guardian.email,
    ],
  );
}

export async function createPatientWithGuardian(patientData, actorUserId) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO patients (
          rut,
          first_names,
          last_names,
          birth_date,
          phone,
          email,
          address,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        RETURNING id
      `,
      [
        patientData.rut,
        patientData.firstNames,
        patientData.lastNames,
        patientData.birthDate,
        patientData.phone,
        patientData.email,
        patientData.address,
        actorUserId,
      ],
    );
    const patientId = result.rows[0].id;

    await upsertGuardian(client, patientId, patientData.guardian);

    return findPatientByIdWithClient(client, patientId);
  });
}

export async function findPatientById(patientId) {
  return findPatientByIdWithClient(
    { query: (text, parameters) => executeQuery(text, parameters) },
    patientId,
  );
}

export async function listPatients({ page, pageSize, search }) {
  const offset = (page - 1) * pageSize;
  const searchPattern = `%${search}%`;
  const compactSearchPattern = `%${search.replace(/[.\s-]/g, "")}%`;
  const filters = `
    $1 = ''
    OR patients.first_names ILIKE $2
    OR patients.last_names ILIKE $2
    OR concat_ws(' ', patients.first_names, patients.last_names) ILIKE $2
    OR patients.email ILIKE $2
    OR patients.phone ILIKE $2
    OR replace(patients.rut, '-', '') ILIKE $3
  `;
  const parameters = [search, searchPattern, compactSearchPattern];
  const [patientsResult, countResult] = await Promise.all([
    executeQuery(
      `
        SELECT
          patients.id,
          patients.rut,
          patients.first_names,
          patients.last_names,
          patients.birth_date,
          patients.phone,
          patients.email,
          patients.address,
          patients.created_at,
          patients.updated_at,
          NULL AS guardian
        FROM patients
        WHERE ${filters}
        ORDER BY patients.last_names, patients.first_names, patients.id
        LIMIT $4 OFFSET $5
      `,
      [...parameters, pageSize, offset],
    ),
    executeQuery(
      `
        SELECT COUNT(*) AS total
        FROM patients
        WHERE ${filters}
      `,
      parameters,
    ),
  ]);
  const total = Number(countResult.rows[0].total);

  return {
    items: patientsResult.rows.map(mapPatient),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export async function updatePatientWithGuardian(
  patientId,
  patientData,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `
        UPDATE patients
        SET
          rut = $2,
          first_names = $3,
          last_names = $4,
          birth_date = $5,
          phone = $6,
          email = $7,
          address = $8,
          updated_by = $9
        WHERE id = $1
        RETURNING id
      `,
      [
        patientId,
        patientData.rut,
        patientData.firstNames,
        patientData.lastNames,
        patientData.birthDate,
        patientData.phone,
        patientData.email,
        patientData.address,
        actorUserId,
      ],
    );

    if (result.rowCount === 0) {
      return null;
    }

    await upsertGuardian(client, patientId, patientData.guardian);

    return findPatientByIdWithClient(client, patientId);
  });
}
