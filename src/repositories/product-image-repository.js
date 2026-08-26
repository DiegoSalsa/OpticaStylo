import { executeQuery, executeTransaction } from "../db/query.js";

function image(row) {
  if (!row) return null;
  return {
    alt: row.alt_text,
    assetId: row.cloudinary_asset_id,
    createdAt: row.created_at,
    filename: row.original_filename,
    format: row.cloudinary_format,
    height: row.height,
    id: row.id,
    mediaType: row.media_type,
    position: Number(row.position),
    publicId: row.cloudinary_public_id,
    sha256: row.file_sha256,
    size: Number(row.file_size_bytes),
    status: row.status,
    url: row.cloudinary_url,
    version: Number(row.cloudinary_version),
    width: row.width,
  };
}

const ACTIVE_IMAGES = `
  SELECT id, product_id, position, alt_text, original_filename, media_type,
         file_size_bytes, file_sha256, cloudinary_asset_id, cloudinary_public_id,
         cloudinary_version, cloudinary_url, cloudinary_format, width, height,
         status, created_at
  FROM product_images
  WHERE status = 'ACTIVE'
`;

export async function listActiveProductImages(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];
  const result = await executeQuery(
    `${ACTIVE_IMAGES} AND product_id = ANY($1::UUID[])
     ORDER BY product_id, position, id`,
    [productIds],
  );
  return result.rows.map((row) => ({ productId: row.product_id, ...image(row) }));
}

export async function findActiveProductImage(productId, imageId) {
  const result = await executeQuery(
    `${ACTIVE_IMAGES} AND product_id = $1 AND id = $2`,
    [productId, imageId],
  );
  return image(result.rows[0]);
}

export async function createProductImage(productId, input, actorUserId) {
  return executeTransaction(async (client) => {
    const product = await client.query("SELECT id FROM products WHERE id = $1 FOR SHARE", [productId]);
    if (product.rowCount === 0) return null;
    const positionResult = await client.query(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM product_images WHERE product_id = $1 AND status = 'ACTIVE'",
      [productId],
    );
    const position = Number(positionResult.rows[0].position);
    if (position > 99) return { reason: "IMAGE_LIMIT_REACHED" };
    const result = await client.query(
      `INSERT INTO product_images (
         product_id, position, alt_text, original_filename, media_type, file_size_bytes,
         file_sha256, cloudinary_asset_id, cloudinary_public_id, cloudinary_version,
         cloudinary_url, cloudinary_format, width, height, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [productId, position, input.alt, input.filename, input.mediaType, input.size,
        input.sha256, input.assetId, input.publicId, input.version, input.url,
        input.format, input.width, input.height, actorUserId],
    );
    await client.query(
      `INSERT INTO product_events (product_id, event_type, changed_fields, performed_by)
       VALUES ($1, 'IMAGE_ADDED', ARRAY['images'], $2)`,
      [productId, actorUserId],
    );
    return { image: image(result.rows[0]), reason: null };
  });
}

export async function retireProductImage(productId, imageId, actorUserId) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `UPDATE product_images
       SET status = 'RETIRED', retired_by = $3, retired_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND product_id = $2 AND status = 'ACTIVE'
       RETURNING *`,
      [imageId, productId, actorUserId],
    );
    const retired = image(result.rows[0]);
    if (!retired) return null;
    await client.query(
      `INSERT INTO product_events (product_id, event_type, changed_fields, performed_by)
       VALUES ($1, 'IMAGE_RETIRED', ARRAY['images'], $2)`,
      [productId, actorUserId],
    );
    return retired;
  });
}
