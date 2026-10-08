import { prisma } from "../db/prisma.js";
import { createHash } from "node:crypto";
import { availableBundledTryOnModels } from "../services/bundled-try-on-models.js";
import { validateTryOnModelMetadata } from "../virtual-try-on-3d/model-contract.js";

function operationalAsset(asset) {
  if (!asset) return false;
  try {
    const bytes = Buffer.from(asset.model_data);
    const metadata = validateTryOnModelMetadata(asset.model_metadata);
    return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "glTF"
      && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length
      && metadata.identity.sha256 === asset.file_sha256
      && createHash("sha256").update(bytes).digest("hex") === asset.file_sha256;
  } catch { return false; }
}

function publicModel(asset) {
  return {
    assetId: asset.id,
    attribution: asset.attribution_text,
    licenseCode: asset.license_code,
    metadataUrl: `/api/store/virtual-try-on/models/${asset.id}/metadata`,
    modelUrl: `/api/store/virtual-try-on/models/${asset.id}/model`,
    name: asset.products.name,
    productId: asset.product_id,
    sku: asset.products.sku,
    unitPriceCents: Number(asset.products.unit_price_cents),
    version: Number(asset.version),
  };
}

const publicModelWhere = {
  status: "ACTIVE",
  products: { category: "FRAME", is_active: true },
};

export async function listActive3dModels() {
  const assets = await prisma.virtual_try_on_3d_assets.findMany({
    include: { products: true },
    orderBy: [{ products: { name: "asc" } }, { product_id: "asc" }],
    where: publicModelWhere,
  });
  return assets.filter(operationalAsset).map(publicModel);
}

export async function listPublished3dModels() {
  const [bundled, published] = await Promise.all([availableBundledTryOnModels(), listActive3dModels()]);
  const products = await prisma.products.findMany({
    where: { category: "FRAME", is_active: true, sku: { in: bundled.map((model) => model.sku) } },
    select: { id: true, name: true, sku: true, unit_price_cents: true },
  });
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const publishedIds = new Set(published.map((model) => model.productId));
  return [...bundled.flatMap((model) => {
    const product = bySku.get(model.sku);
    return product && !publishedIds.has(product.id) ? [{
      ...model, name: product.name, productId: product.id, unitPriceCents: Number(product.unit_price_cents),
    }] : [];
  }), ...published];
}

export async function findPublic3dModelFile(assetId) {
  const asset = await prisma.virtual_try_on_3d_assets.findFirst({
    select: { file_sha256: true, model_data: true, model_metadata: true, original_filename: true },
    where: { id: assetId, ...publicModelWhere },
  });
  return operationalAsset(asset) ? {
    data: asset.model_data,
    filename: asset.original_filename,
    sha256: asset.file_sha256,
  } : null;
}

export async function findPublic3dModelMetadata(assetId) {
  const asset = await prisma.virtual_try_on_3d_assets.findFirst({
    select: {
      attribution_text: true,
      file_sha256: true,
      license_code: true,
      model_metadata: true,
      model_data: true,
    },
    where: { id: assetId, ...publicModelWhere },
  });
  return operationalAsset(asset) ? {
    attribution: asset.attribution_text,
    licenseCode: asset.license_code,
    metadata: asset.model_metadata,
    modelSha256: asset.file_sha256,
  } : null;
}
