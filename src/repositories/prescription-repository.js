import { executeQuery, executeTransaction } from "../db/query.js";

function toNumber(value) {
  return value === null ? null : Number(value);
}

function mapPrescription(row) {
  if (!row) {
    return null;
  }

  return {
    encounterId: row.encounter_id,
    fulfillmentNotes: row.fulfillment_notes,
    id: row.id,
    issuedAt: row.issued_at,
    issuedBy: {
      firstName: row.issuer_first_name,
      id: row.issued_by,
      lastName: row.issuer_last_name,
    },
    leftEye: {
      addition: toNumber(row.left_addition),
      axis: row.left_axis,
      cylinder: toNumber(row.left_cylinder),
      sphere: toNumber(row.left_sphere),
    },
    patient: {
      firstNames: row.patient_first_names,
      id: row.patient_id,
      lastNames: row.patient_last_names,
      rut: row.patient_rut,
    },
    pupillaryDistance: toNumber(row.pupillary_distance),
    replacedPrescriptionId: row.replaced_prescription_id,
    replacementReason: row.replacement_reason,
    rightEye: {
      addition: toNumber(row.right_addition),
      axis: row.right_axis,
      cylinder: toNumber(row.right_cylinder),
      sphere: toNumber(row.right_sphere),
    },
    status: row.status,
    updatedAt: row.updated_at,
    version: row.version,
    voidedAt: row.voided_at,
  };
}

const PRESCRIPTION_SELECT = `
  SELECT
    optical_prescriptions.*,
    clinical_encounters.patient_id,
    clinical_encounters.professional_id,
    clinical_encounters.status AS encounter_status,
    patients.rut AS patient_rut,
    patients.first_names AS patient_first_names,
    patients.last_names AS patient_last_names,
    issuer.first_name AS issuer_first_name,
    issuer.last_name AS issuer_last_name
  FROM optical_prescriptions
  JOIN clinical_encounters
    ON clinical_encounters.id = optical_prescriptions.encounter_id
  JOIN patients ON patients.id = clinical_encounters.patient_id
  JOIN users AS issuer ON issuer.id = optical_prescriptions.issued_by
`;

async function findPrescriptionWithClient(client, prescriptionId) {
  const result = await client.query(
    `${PRESCRIPTION_SELECT} WHERE optical_prescriptions.id = $1`,
    [prescriptionId],
  );

  const prescription = mapPrescription(result.rows[0]);

  if (!prescription) {
    return null;
  }

  return {
    ...prescription,
    encounterStatus: result.rows[0].encounter_status,
    professionalId: result.rows[0].professional_id,
  };
}

export async function findPrescriptionById(prescriptionId) {
  return findPrescriptionWithClient(
    { query: (text, parameters) => executeQuery(text, parameters) },
    prescriptionId,
  );
}

export async function listPrescriptionsByPatientId(patientId) {
  const result = await executeQuery(
    `
      ${PRESCRIPTION_SELECT}
      WHERE clinical_encounters.patient_id = $1
      ORDER BY optical_prescriptions.issued_at DESC, optical_prescriptions.version DESC
    `,
    [patientId],
  );

  return result.rows.map((row) => ({
    ...mapPrescription(row),
    encounterStatus: row.encounter_status,
    professionalId: row.professional_id,
  }));
}

function prescriptionValues(data) {
  return [
    data.rightEye.sphere,
    data.rightEye.cylinder,
    data.rightEye.axis,
    data.rightEye.addition,
    data.leftEye.sphere,
    data.leftEye.cylinder,
    data.leftEye.axis,
    data.leftEye.addition,
    data.pupillaryDistance,
    data.fulfillmentNotes,
  ];
}

export async function createOrReplacePrescription(
  encounterId,
  prescriptionData,
  actorUserId,
  issuedAt,
) {
  return executeTransaction(async (client) => {
    const encounterResult = await client.query(
      `
        SELECT id, professional_id, status
        FROM clinical_encounters
        WHERE id = $1
        FOR UPDATE
      `,
      [encounterId],
    );
    const encounter = encounterResult.rows[0];

    if (!encounter) {
      return { prescription: null, reason: "ENCOUNTER_NOT_FOUND" };
    }

    if (encounter.professional_id !== actorUserId) {
      return { prescription: null, reason: "NOT_ASSIGNED" };
    }

    const activeResult = await client.query(
      `
        SELECT id, version
        FROM optical_prescriptions
        WHERE encounter_id = $1 AND status = 'ACTIVE'
        FOR UPDATE
      `,
      [encounterId],
    );
    const active = activeResult.rows[0];

    if (!active && encounter.status !== "DRAFT") {
      return { prescription: null, reason: "FINALIZED_WITHOUT_PRESCRIPTION" };
    }

    if (active && encounter.status === "DRAFT") {
      return { prescription: null, reason: "PRESCRIPTION_ALREADY_EXISTS" };
    }

    if (active && !prescriptionData.replacementReason) {
      return { prescription: null, reason: "REPLACEMENT_REASON_REQUIRED" };
    }

    if (!active && prescriptionData.replacementReason) {
      return { prescription: null, reason: "UNEXPECTED_REPLACEMENT_REASON" };
    }

    if (active) {
      await client.query(
        `
          UPDATE optical_prescriptions
          SET status = 'VOIDED', voided_at = $2
          WHERE id = $1
        `,
        [active.id, issuedAt],
      );
    }

    const result = await client.query(
      `
        INSERT INTO optical_prescriptions (
          encounter_id,
          version,
          right_sphere,
          right_cylinder,
          right_axis,
          right_addition,
          left_sphere,
          left_cylinder,
          left_axis,
          left_addition,
          pupillary_distance,
          fulfillment_notes,
          replaced_prescription_id,
          replacement_reason,
          issued_by,
          issued_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16
        )
        RETURNING id
      `,
      [
        encounterId,
        active ? active.version + 1 : 1,
        ...prescriptionValues(prescriptionData),
        active?.id ?? null,
        prescriptionData.replacementReason,
        actorUserId,
        issuedAt,
      ],
    );

    return {
      prescription: await findPrescriptionWithClient(client, result.rows[0].id),
      reason: null,
    };
  });
}

export async function updatePrescription(
  prescriptionId,
  changes,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    const currentResult = await client.query(
      `
        SELECT
          optical_prescriptions.*,
          clinical_encounters.professional_id,
          clinical_encounters.status AS encounter_status
        FROM optical_prescriptions
        JOIN clinical_encounters
          ON clinical_encounters.id = optical_prescriptions.encounter_id
        WHERE optical_prescriptions.id = $1
        FOR UPDATE OF optical_prescriptions, clinical_encounters
      `,
      [prescriptionId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      return { prescription: null, reason: "NOT_FOUND" };
    }

    if (current.professional_id !== actorUserId) {
      return { prescription: null, reason: "NOT_ASSIGNED" };
    }

    if (current.status !== "ACTIVE" || current.encounter_status !== "DRAFT") {
      return { prescription: null, reason: "IMMUTABLE" };
    }

    const merged = {
      fulfillmentNotes:
        changes.fulfillmentNotes === undefined
          ? current.fulfillment_notes
          : changes.fulfillmentNotes,
      leftEye: changes.leftEye ?? {
        addition: toNumber(current.left_addition),
        axis: current.left_axis,
        cylinder: toNumber(current.left_cylinder),
        sphere: toNumber(current.left_sphere),
      },
      pupillaryDistance:
        changes.pupillaryDistance === undefined
          ? toNumber(current.pupillary_distance)
          : changes.pupillaryDistance,
      rightEye: changes.rightEye ?? {
        addition: toNumber(current.right_addition),
        axis: current.right_axis,
        cylinder: toNumber(current.right_cylinder),
        sphere: toNumber(current.right_sphere),
      },
    };

    await client.query(
      `
        UPDATE optical_prescriptions
        SET
          right_sphere = $2,
          right_cylinder = $3,
          right_axis = $4,
          right_addition = $5,
          left_sphere = $6,
          left_cylinder = $7,
          left_axis = $8,
          left_addition = $9,
          pupillary_distance = $10,
          fulfillment_notes = $11
        WHERE id = $1
      `,
      [prescriptionId, ...prescriptionValues(merged)],
    );

    return {
      prescription: await findPrescriptionWithClient(client, prescriptionId),
      reason: null,
    };
  });
}
