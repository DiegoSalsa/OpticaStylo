import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con virtual-try-on-3d-repository.

// Centralizar la lógica de público modelo para mantener consistente el comportamiento de la aplicación
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

// Consultar list active3d modelos y devolver los datos en el formato esperado por la capa llamadora
export async function listActive3dModels() {
  const assets = await prisma.virtual_try_on_3d_assets.findMany({
    include: { products: true },
    orderBy: [{ products: { name: "asc" } }, { product_id: "asc" }],
    where: publicModelWhere,
  });
  return assets.map(publicModel);
}

// Consultar find public3d modelo archivo y devolver los datos en el formato esperado por la capa llamadora
export async function findPublic3dModelFile(assetId) {
  const asset = await prisma.virtual_try_on_3d_assets.findFirst({
    select: { file_sha256: true, model_data: true, original_filename: true },
    where: { id: assetId, ...publicModelWhere },
  });
  return asset ? {
    data: asset.model_data,
    filename: asset.original_filename,
    sha256: asset.file_sha256,
  } : null;
}

// Consultar find public3d modelo metadatos y devolver los datos en el formato esperado por la capa llamadora
export async function findPublic3dModelMetadata(assetId) {
  const asset = await prisma.virtual_try_on_3d_assets.findFirst({
    select: {
      attribution_text: true,
      file_sha256: true,
      license_code: true,
      model_metadata: true,
    },
    where: { id: assetId, ...publicModelWhere },
  });
  return asset ? {
    attribution: asset.attribution_text,
    licenseCode: asset.license_code,
    metadata: asset.model_metadata,
    modelSha256: asset.file_sha256,
  } : null;
}
