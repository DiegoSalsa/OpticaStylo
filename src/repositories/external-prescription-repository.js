import { executeTransaction } from "../db/query.js";

function mapPrescription(row) {
  if (!row) return null;
  return {
    confirmedAt: row.confirmed_at,
    confirmedData: row.confirmed_data,
    customerId: row.customer_id,
    id: row.id,
    originalFilename: row.original_filename,
    source: row.source,
    status: row.status,
  };
}

export async function createPointOfSaleExternalPrescription(
  input,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    const customer = await client.query(
      "SELECT id FROM customers WHERE id = $1 FOR SHARE",
      [input.customerId],
    );
    if (customer.rowCount === 0)
      return { prescription: null, reason: "CUSTOMER_NOT_FOUND" };
    const result = await client.query(
      `INSERT INTO external_prescriptions (
         customer_id, source, status, original_filename, media_type,
         file_size_bytes, file_sha256, file_data, extraction_status,
         confirmed_data, confirmed_at, created_by
       ) VALUES (
         $1, $2, 'READY', $3, $4, $5, $6, $7,
         $8, $9::JSONB, $10, $11
       ) RETURNING *`,
      [
        input.customerId,
        input.source,
        input.filename,
        input.mediaType,
        input.size,
        input.sha256,
        input.data,
        input.source === "IMAGE" ? "NOT_CONFIGURED" : "NOT_REQUESTED",
        JSON.stringify(input.confirmedData),
        input.confirmedAt,
        actorUserId,
      ],
    );
    return { prescription: mapPrescription(result.rows[0]), reason: null };
  });
}
