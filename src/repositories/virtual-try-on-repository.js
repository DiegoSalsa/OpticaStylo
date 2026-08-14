import { executeQuery, executeTransaction } from "../db/query.js";

function mapAsset(row) {
  if (!row) return null;
  return {
    assetId: row.id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    fileSizeBytes: Number(row.file_size_bytes),
    imageUrl: `/api/store/virtual-try-on/frames/${row.id}/image`,
    mediaType: row.media_type,
    notes: row.notes,
    originalFilename: row.original_filename,
    productId: row.product_id,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
    rotationOffsetDegrees: Number(row.rotation_offset_degrees),
    status: row.status,
    version: Number(row.version),
    verticalOffset: Number(row.vertical_offset),
    widthScale: Number(row.width_scale),
  };
}

function mapPublicFrame(row) {
  return {
    assetId: row.id,
    imageUrl: `/api/store/virtual-try-on/frames/${row.id}/image`,
    name: row.product_name,
    productId: row.product_id,
    rotationOffsetDegrees: Number(row.rotation_offset_degrees),
    sku: row.product_sku,
    unitPriceCents: Number(row.unit_price_cents),
    verticalOffset: Number(row.vertical_offset),
    widthScale: Number(row.width_scale),
  };
}

export async function replaceActiveVirtualTryOnAsset(productId, asset, actorUserId) {
  return executeTransaction(async (client) => {
    await client.query(
      `SELECT id FROM products WHERE id = $1 FOR UPDATE`,
      [productId],
    );
    await client.query(
      `UPDATE virtual_try_on_assets
       SET status = 'RETIRED', retired_by = $2, retired_at = CURRENT_TIMESTAMP
       WHERE product_id = $1 AND status = 'ACTIVE'`,
      [productId, actorUserId],
    );
    const result = await client.query(
      `INSERT INTO virtual_try_on_assets (
         product_id, version, original_filename, media_type, file_size_bytes,
         file_sha256, file_data, width_scale, vertical_offset,
         rotation_offset_degrees, notes, created_by
       )
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11
       FROM virtual_try_on_assets
       WHERE product_id = $1
       RETURNING *`,
      [
        productId,
        asset.filename,
        asset.mediaType,
        asset.size,
        asset.sha256,
        asset.data,
        asset.widthScale,
        asset.verticalOffset,
        asset.rotationOffsetDegrees,
        asset.notes,
        actorUserId,
      ],
    );
    return mapAsset(result.rows[0]);
  });
}

export async function listVirtualTryOnAssetVersions(productId) {
  const result = await executeQuery(
    `SELECT * FROM virtual_try_on_assets
     WHERE product_id = $1
     ORDER BY version DESC`,
    [productId],
  );
  return result.rows.map(mapAsset);
}

export async function retireActiveVirtualTryOnAsset(productId, actorUserId) {
  const result = await executeQuery(
    `UPDATE virtual_try_on_assets
     SET status = 'RETIRED', retired_by = $2, retired_at = CURRENT_TIMESTAMP
     WHERE product_id = $1 AND status = 'ACTIVE'
     RETURNING *`,
    [productId, actorUserId],
  );
  return mapAsset(result.rows[0]);
}

export async function listActiveVirtualTryOnFrames() {
  const result = await executeQuery(
    `SELECT assets.*, products.name AS product_name, products.sku AS product_sku,
            products.unit_price_cents
     FROM virtual_try_on_assets AS assets
     INNER JOIN products ON products.id = assets.product_id
     WHERE assets.status = 'ACTIVE'
       AND products.is_active = TRUE
       AND products.category = 'FRAME'
     ORDER BY products.name, products.id`,
  );
  return result.rows.map(mapPublicFrame);
}

export async function findPublicVirtualTryOnAssetFile(assetId) {
  const result = await executeQuery(
    `SELECT assets.file_data, assets.file_sha256, assets.media_type,
            assets.original_filename
     FROM virtual_try_on_assets AS assets
     INNER JOIN products ON products.id = assets.product_id
     WHERE assets.id = $1
       AND assets.status = 'ACTIVE'
       AND products.is_active = TRUE
       AND products.category = 'FRAME'`,
    [assetId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    data: row.file_data,
    filename: row.original_filename,
    mediaType: row.media_type,
    sha256: row.file_sha256,
  };
}
