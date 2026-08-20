import { executeQuery } from "../db/query.js";

function publicModel(row) {
  return {
    assetId: row.id,
    attribution: row.attribution_text,
    licenseCode: row.license_code,
    metadataUrl: `/api/store/virtual-try-on/models/${row.id}/metadata`,
    modelUrl: `/api/store/virtual-try-on/models/${row.id}/model`,
    name: row.product_name,
    productId: row.product_id,
    sku: row.product_sku,
    unitPriceCents: Number(row.unit_price_cents),
    version: Number(row.version),
  };
}

const PUBLIC_MODEL_FROM = `
  FROM virtual_try_on_3d_assets AS assets
  JOIN products ON products.id = assets.product_id
  WHERE assets.status = 'ACTIVE'
    AND products.is_active = TRUE
    AND products.category = 'FRAME'
`;

export async function listActive3dModels() {
  const result = await executeQuery(
    `SELECT assets.id, assets.product_id, assets.version, assets.license_code,
            assets.attribution_text, products.name AS product_name,
            products.sku AS product_sku, products.unit_price_cents
     ${PUBLIC_MODEL_FROM}
     ORDER BY products.name, products.id`,
  );
  return result.rows.map(publicModel);
}

export async function findPublic3dModelFile(assetId) {
  const result = await executeQuery(
    `SELECT assets.model_data, assets.file_sha256, assets.original_filename
     ${PUBLIC_MODEL_FROM} AND assets.id = $1`, [assetId],
  );
  const row = result.rows[0];
  return row ? { data: row.model_data, filename: row.original_filename, sha256: row.file_sha256 } : null;
}

export async function findPublic3dModelMetadata(assetId) {
  const result = await executeQuery(
    `SELECT assets.model_metadata, assets.file_sha256, assets.license_code,
            assets.attribution_text
     ${PUBLIC_MODEL_FROM} AND assets.id = $1`, [assetId],
  );
  const row = result.rows[0];
  return row ? {
    attribution: row.attribution_text,
    licenseCode: row.license_code,
    metadata: row.model_metadata,
    modelSha256: row.file_sha256,
  } : null;
}
