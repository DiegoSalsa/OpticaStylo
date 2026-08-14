import { executeQuery, executeTransaction } from "../db/query.js";

const MEDICAL_RECORD_COLUMNS = Object.freeze({
  allergies: "allergies",
  currentMedications: "current_medications",
  familyOcularHistory: "family_ocular_history",
  generalMedicalHistory: "general_medical_history",
  ocularHistory: "ocular_history",
});
const ENCOUNTER_COLUMNS = Object.freeze({
  anamnesis: "anamnesis",
  diagnosis: "diagnosis",
  examination: "examination",
  indications: "indications",
  reasonForVisit: "reason_for_visit",
});

function mapMedicalRecord(row) {
  if (!row) {
    return null;
  }

  return {
    allergies: row.allergies,
    createdAt: row.created_at,
    currentMedications: row.current_medications,
    familyOcularHistory: row.family_ocular_history,
    generalMedicalHistory: row.general_medical_history,
    id: row.id,
    ocularHistory: row.ocular_history,
    patientId: row.patient_id,
    updatedAt: row.updated_at,
  };
}

function mapAddendum(row) {
  return {
    authoredBy: {
      firstName: row.author_first_name,
      id: row.authored_by,
      lastName: row.author_last_name,
    },
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    reason: row.reason,
  };
}

function mapEncounter(row, additions = {}) {
  if (!row) {
    return null;
  }

  return {
    anamnesis: row.anamnesis,
    appointmentId: row.appointment_id,
    createdAt: row.created_at,
    diagnosis: row.diagnosis,
    examination: row.examination,
    finalizedAt: row.finalized_at,
    id: row.id,
    indications: row.indications,
    patient: {
      firstNames: row.patient_first_names,
      id: row.patient_id,
      lastNames: row.patient_last_names,
      rut: row.patient_rut,
    },
    professional: {
      firstName: row.professional_first_name,
      id: row.professional_id,
      lastName: row.professional_last_name,
    },
    reasonForVisit: row.reason_for_visit,
    status: row.status,
    updatedAt: row.updated_at,
    ...additions,
  };
}

const ENCOUNTER_SELECT = `
  SELECT
    clinical_encounters.*,
    patients.rut AS patient_rut,
    patients.first_names AS patient_first_names,
    patients.last_names AS patient_last_names,
    professional_users.first_name AS professional_first_name,
    professional_users.last_name AS professional_last_name
  FROM clinical_encounters
  JOIN patients ON patients.id = clinical_encounters.patient_id
  JOIN users AS professional_users
    ON professional_users.id = clinical_encounters.professional_id
`;

async function findEncounterWithClient(client, encounterId) {
  const result = await client.query(
    `${ENCOUNTER_SELECT} WHERE clinical_encounters.id = $1`,
    [encounterId],
  );

  return mapEncounter(result.rows[0]);
}

export async function hasClinicalAssignment(
  patientId,
  professionalId,
  statuses = ["CONFIRMED", "CHECKED_IN", "COMPLETED"],
) {
  const result = await executeQuery(
    `
      SELECT EXISTS (
        SELECT 1
        FROM appointments
        WHERE
          patient_id = $1
          AND professional_id = $2
          AND status = ANY($3::varchar[])
      ) AS assigned
    `,
    [patientId, professionalId, statuses],
  );

  return result.rows[0].assigned;
}

export async function findMedicalRecordByPatientId(patientId) {
  const result = await executeQuery(
    `
      SELECT *
      FROM medical_records
      WHERE patient_id = $1
    `,
    [patientId],
  );

  return mapMedicalRecord(result.rows[0]);
}

export async function upsertMedicalRecord(patientId, changes, actorUserId) {
  return executeTransaction(async (client) => {
    await client.query("SELECT id FROM patients WHERE id = $1 FOR UPDATE", [
      patientId,
    ]);
    const currentResult = await client.query(
      "SELECT id FROM medical_records WHERE patient_id = $1 FOR UPDATE",
      [patientId],
    );
    const current = currentResult.rows[0];
    let medicalRecordId;

    if (!current) {
      const values = Object.fromEntries(
        Object.keys(MEDICAL_RECORD_COLUMNS).map((field) => [
          field,
          changes[field] ?? null,
        ]),
      );
      const result = await client.query(
        `
          INSERT INTO medical_records (
            patient_id,
            general_medical_history,
            ocular_history,
            family_ocular_history,
            allergies,
            current_medications,
            created_by,
            updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          RETURNING id
        `,
        [
          patientId,
          values.generalMedicalHistory,
          values.ocularHistory,
          values.familyOcularHistory,
          values.allergies,
          values.currentMedications,
          actorUserId,
        ],
      );
      medicalRecordId = result.rows[0].id;
    } else {
      medicalRecordId = current.id;
      const entries = Object.entries(changes);
      const assignments = entries.map(
        ([field], index) => `${MEDICAL_RECORD_COLUMNS[field]} = $${index + 2}`,
      );

      await client.query(
        `
          UPDATE medical_records
          SET ${assignments.join(", ")}, updated_by = $${entries.length + 2}
          WHERE id = $1
        `,
        [medicalRecordId, ...entries.map(([, value]) => value), actorUserId],
      );
    }

    await client.query(
      `
        INSERT INTO medical_record_events (
          medical_record_id,
          event_type,
          changed_fields,
          performed_by
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        medicalRecordId,
        current ? "UPDATED" : "CREATED",
        Object.keys(changes),
        actorUserId,
      ],
    );

    const result = await client.query(
      "SELECT * FROM medical_records WHERE id = $1",
      [medicalRecordId],
    );

    return mapMedicalRecord(result.rows[0]);
  });
}

export async function createClinicalEncounter(encounterData, actorUserId) {
  return executeTransaction(async (client) => {
    const appointmentResult = await client.query(
      `
        SELECT id, patient_id, professional_id, status
        FROM appointments
        WHERE id = $1
        FOR UPDATE
      `,
      [encounterData.appointmentId],
    );
    const appointment = appointmentResult.rows[0];

    if (!appointment) {
      return { encounter: null, reason: "APPOINTMENT_NOT_FOUND" };
    }

    if (appointment.professional_id !== actorUserId) {
      return { encounter: null, reason: "NOT_ASSIGNED" };
    }

    if (appointment.status !== "CHECKED_IN") {
      return { encounter: null, reason: "INVALID_APPOINTMENT_STATUS" };
    }

    const existingResult = await client.query(
      "SELECT id FROM clinical_encounters WHERE appointment_id = $1",
      [appointment.id],
    );

    if (existingResult.rowCount > 0) {
      return { encounter: null, reason: "ENCOUNTER_ALREADY_EXISTS" };
    }

    const result = await client.query(
      `
        INSERT INTO clinical_encounters (
          appointment_id,
          patient_id,
          professional_id,
          reason_for_visit,
          anamnesis,
          examination,
          diagnosis,
          indications,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $3, $3)
        RETURNING id
      `,
      [
        appointment.id,
        appointment.patient_id,
        appointment.professional_id,
        encounterData.reasonForVisit,
        encounterData.anamnesis,
        encounterData.examination,
        encounterData.diagnosis,
        encounterData.indications,
      ],
    );
    const encounterId = result.rows[0].id;

    await client.query(
      `
        INSERT INTO clinical_encounter_events (
          encounter_id,
          event_type,
          changed_fields,
          performed_by
        )
        VALUES ($1, 'CREATED', $2, $3)
      `,
      [encounterId, Object.keys(encounterData).filter((field) => field !== "appointmentId"), actorUserId],
    );

    return {
      encounter: await findEncounterWithClient(client, encounterId),
      reason: null,
    };
  });
}

export async function findClinicalEncounterById(encounterId) {
  const [encounterResult, addendaResult] = await Promise.all([
    executeQuery(`${ENCOUNTER_SELECT} WHERE clinical_encounters.id = $1`, [
      encounterId,
    ]),
    executeQuery(
      `
        SELECT
          clinical_encounter_addenda.*,
          users.first_name AS author_first_name,
          users.last_name AS author_last_name
        FROM clinical_encounter_addenda
        JOIN users ON users.id = clinical_encounter_addenda.authored_by
        WHERE encounter_id = $1
        ORDER BY created_at, id
      `,
      [encounterId],
    ),
  ]);

  if (!encounterResult.rows[0]) {
    return null;
  }

  return mapEncounter(encounterResult.rows[0], {
    addenda: addendaResult.rows.map(mapAddendum),
  });
}

export async function updateClinicalEncounter(
  encounterId,
  changes,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    const currentResult = await client.query(
      `
        SELECT id, professional_id, status
        FROM clinical_encounters
        WHERE id = $1
        FOR UPDATE
      `,
      [encounterId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      return { encounter: null, reason: "NOT_FOUND" };
    }

    if (current.professional_id !== actorUserId) {
      return { encounter: null, reason: "NOT_ASSIGNED" };
    }

    if (current.status !== "DRAFT") {
      return { encounter: null, reason: "FINALIZED" };
    }

    const entries = Object.entries(changes);
    const assignments = entries.map(
      ([field], index) => `${ENCOUNTER_COLUMNS[field]} = $${index + 2}`,
    );

    await client.query(
      `
        UPDATE clinical_encounters
        SET ${assignments.join(", ")}, updated_by = $${entries.length + 2}
        WHERE id = $1
      `,
      [encounterId, ...entries.map(([, value]) => value), actorUserId],
    );
    await client.query(
      `
        INSERT INTO clinical_encounter_events (
          encounter_id,
          event_type,
          changed_fields,
          performed_by
        )
        VALUES ($1, 'UPDATED', $2, $3)
      `,
      [encounterId, Object.keys(changes), actorUserId],
    );

    return {
      encounter: await findEncounterWithClient(client, encounterId),
      reason: null,
    };
  });
}

export async function finalizeClinicalEncounter(
  encounterId,
  actorUserId,
  finalizedAt,
) {
  return executeTransaction(async (client) => {
    const currentResult = await client.query(
      `
        SELECT
          clinical_encounters.id,
          clinical_encounters.appointment_id,
          clinical_encounters.professional_id,
          clinical_encounters.status,
          clinical_encounters.examination,
          clinical_encounters.diagnosis,
          appointments.status AS appointment_status
        FROM clinical_encounters
        JOIN appointments ON appointments.id = clinical_encounters.appointment_id
        WHERE clinical_encounters.id = $1
        FOR UPDATE OF clinical_encounters, appointments
      `,
      [encounterId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      return { encounter: null, reason: "NOT_FOUND" };
    }

    if (current.professional_id !== actorUserId) {
      return { encounter: null, reason: "NOT_ASSIGNED" };
    }

    if (current.status !== "DRAFT") {
      return { encounter: null, reason: "ALREADY_FINALIZED" };
    }

    if (current.appointment_status !== "CHECKED_IN") {
      return { encounter: null, reason: "INVALID_APPOINTMENT_STATUS" };
    }

    if (!current.examination || !current.diagnosis) {
      return { encounter: null, reason: "INCOMPLETE" };
    }

    await client.query(
      `
        UPDATE clinical_encounters
        SET status = 'FINALIZED', finalized_at = $2, updated_by = $3
        WHERE id = $1
      `,
      [encounterId, finalizedAt, actorUserId],
    );
    await client.query(
      `
        UPDATE appointments
        SET status = 'COMPLETED', updated_by = $2
        WHERE id = $1
      `,
      [current.appointment_id, actorUserId],
    );
    await client.query(
      `
        INSERT INTO appointment_events (
          appointment_id,
          event_type,
          previous_status,
          new_status,
          details,
          performed_by
        )
        VALUES ($1, 'STATUS_CHANGED', 'CHECKED_IN', 'COMPLETED', $2, $3)
      `,
      [
        current.appointment_id,
        "Atención completada al finalizar el registro clínico.",
        actorUserId,
      ],
    );
    await client.query(
      `
        INSERT INTO clinical_encounter_events (
          encounter_id,
          event_type,
          performed_by
        )
        VALUES ($1, 'FINALIZED', $2)
      `,
      [encounterId, actorUserId],
    );

    return {
      encounter: await findEncounterWithClient(client, encounterId),
      reason: null,
    };
  });
}

export async function addClinicalEncounterAddendum(
  encounterId,
  addendumData,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    const currentResult = await client.query(
      `
        SELECT id, patient_id, status
        FROM clinical_encounters
        WHERE id = $1
        FOR UPDATE
      `,
      [encounterId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      return { addendum: null, patientId: null, reason: "NOT_FOUND" };
    }

    if (current.status !== "FINALIZED") {
      return {
        addendum: null,
        patientId: current.patient_id,
        reason: "NOT_FINALIZED",
      };
    }

    const result = await client.query(
      `
        INSERT INTO clinical_encounter_addenda (
          encounter_id,
          reason,
          content,
          authored_by
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [encounterId, addendumData.reason, addendumData.content, actorUserId],
    );
    await client.query(
      `
        INSERT INTO clinical_encounter_events (
          encounter_id,
          event_type,
          performed_by
        )
        VALUES ($1, 'ADDENDUM_ADDED', $2)
      `,
      [encounterId, actorUserId],
    );
    const userResult = await client.query(
      "SELECT first_name, last_name FROM users WHERE id = $1",
      [actorUserId],
    );

    return {
      addendum: mapAddendum({
        ...result.rows[0],
        author_first_name: userResult.rows[0].first_name,
        author_last_name: userResult.rows[0].last_name,
      }),
      patientId: current.patient_id,
      reason: null,
    };
  });
}

export async function listPatientClinicalHistory(patientId) {
  const encounterResult = await executeQuery(
    `
      ${ENCOUNTER_SELECT}
      WHERE
        clinical_encounters.patient_id = $1
        AND clinical_encounters.status = 'FINALIZED'
      ORDER BY clinical_encounters.finalized_at DESC, clinical_encounters.id
    `,
    [patientId],
  );

  return encounterResult.rows.map((row) => mapEncounter(row));
}
