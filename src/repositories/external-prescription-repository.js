import { executeQuery, executeTransaction } from "../db/query.js";

function mapPrescription(row) {
  if (!row) return null;
  return {
    confirmedAt: row.confirmed_at,
    confirmedData: row.confirmed_data,
    createdAt: row.created_at,
    customerId: row.customer_id,
    cloudinaryAssetId: row.cloudinary_asset_id,
    fileSha256: row.file_sha256,
    fileSizeBytes: row.file_size_bytes,
    hasImage: row.source === "IMAGE",
    id: row.id,
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    patient: row.patient_id ? {
      firstNames: row.patient_first_names,
      id: row.patient_id,
      lastNames: row.patient_last_names,
      rut: row.patient_rut,
    } : null,
    source: row.source,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

const SELECT = `
  SELECT external_prescriptions.*,
         patients.rut AS patient_rut,
         patients.first_names AS patient_first_names,
         patients.last_names AS patient_last_names
  FROM external_prescriptions
  LEFT JOIN patients ON patients.id = external_prescriptions.patient_id
`;

export async function createPointOfSaleExternalPrescription(input, actorUserId) {
  return executeTransaction(async (client) => {
    const [customer, patient] = await Promise.all([
      client.query("SELECT id FROM customers WHERE id = $1 FOR SHARE", [input.customerId]),
      client.query("SELECT id FROM patients WHERE id = $1 FOR SHARE", [input.patientId]),
    ]);
    if (customer.rowCount === 0) return { prescription: null, reason: "CUSTOMER_NOT_FOUND" };
    if (patient.rowCount === 0) return { prescription: null, reason: "PATIENT_NOT_FOUND" };
    const result = await client.query(
      `INSERT INTO external_prescriptions (
         customer_id, patient_id, source, status, original_filename, media_type,
         file_size_bytes, file_sha256, file_data, cloudinary_asset_id,
         cloudinary_public_id, cloudinary_version, cloudinary_format, extraction_status,
         confirmed_data, confirmed_at, created_by
       ) VALUES (
         $1, $2, $3, 'READY', $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15::JSONB, $16
       ) RETURNING id`,
      [input.customerId, input.patientId, input.source, input.filename,
        input.mediaType, input.size, input.sha256, input.data,
        input.cloudinary?.assetId ?? null, input.cloudinary?.publicId ?? null,
        input.cloudinary?.version ?? null, input.cloudinary?.format ?? null,
        input.source === "IMAGE" ? "NOT_CONFIGURED" : "NOT_REQUESTED",
        JSON.stringify(input.confirmedData), input.confirmedAt, actorUserId],
    );
    return {
      prescription: await findExternalPrescriptionWithClient(client, result.rows[0].id),
      reason: null,
    };
  });
}

async function findExternalPrescriptionWithClient(client, id) {
  const result = await client.query(`${SELECT} WHERE external_prescriptions.id = $1`, [id]);
  return mapPrescription(result.rows[0]);
}

export async function findExternalPrescriptionById(id) {
  return findExternalPrescriptionWithClient(
    { query: (text, parameters) => executeQuery(text, parameters) },
    id,
  );
}

export async function listExternalPrescriptionsByPatient(patientId) {
  const result = await executeQuery(
    `${SELECT}
     WHERE external_prescriptions.patient_id = $1
       AND external_prescriptions.status = 'READY'
     ORDER BY external_prescriptions.created_at DESC`,
    [patientId],
  );
  return result.rows.map(mapPrescription);
}

export async function findExternalPrescriptionFileById(id) {
  const result = await executeQuery(
    `SELECT original_filename, media_type, file_data, cloudinary_asset_id,
            cloudinary_public_id, cloudinary_version, cloudinary_format
     FROM external_prescriptions
     WHERE id = $1 AND source = 'IMAGE'`,
    [id],
  );
  const row = result.rows[0];
  return row ? {
    cloudinary: row.cloudinary_asset_id ? {
      assetId: row.cloudinary_asset_id,
      format: row.cloudinary_format,
      publicId: row.cloudinary_public_id,
      version: Number(row.cloudinary_version),
    } : null,
    data: row.file_data,
    filename: row.original_filename,
    mediaType: row.media_type,
  } : null;
}
