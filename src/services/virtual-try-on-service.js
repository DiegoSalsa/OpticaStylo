import { createHash } from "node:crypto";

import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { findProductById } from "../repositories/product-repository.js";
import {
  findPublicVirtualTryOnAssetFile,
  listActiveVirtualTryOnFrames,
  listVirtualTryOnAssetVersions,
  replaceActiveVirtualTryOnAsset,
  retireActiveVirtualTryOnAsset,
} from "../repositories/virtual-try-on-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateProductId } from "../validations/product-validation.js";
import {
  validateVirtualTryOnAssetId,
  validateVirtualTryOnImageBytes,
  validateVirtualTryOnUpload,
} from "../validations/virtual-try-on-validation.js";

function productNotFound() {
  throw new AppError({
    code: "PRODUCT_NOT_FOUND",
    message: "No se encontró el producto.",
    status: 404,
  });
}

function assetNotFound() {
  throw new AppError({
    code: "VIRTUAL_TRY_ON_ASSET_NOT_FOUND",
    message: "No se encontró el recurso de prueba virtual.",
    status: 404,
  });
}

async function getFrameProduct(productId, dependencies) {
  const product = await (dependencies.findProductById ?? findProductById)(
    validateProductId(productId),
  );
  if (!product) productNotFound();
  if (product.category !== "FRAME") {
    throw new AppError({
      code: "VIRTUAL_TRY_ON_REQUIRES_FRAME",
      message: "La prueba virtual solo puede configurarse para productos de tipo marco.",
      status: 409,
    });
  }
  return product;
}

export async function uploadVirtualTryOnAsset(
  productId,
  formData,
  actor,
  dependencies = {},
) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  const product = await getFrameProduct(productId, dependencies);
  const input = validateVirtualTryOnUpload(formData);
  const data = validateVirtualTryOnImageBytes(
    Buffer.from(await input.image.file.arrayBuffer()),
    input.image.mediaType,
  );
  if (data.length !== input.image.size) {
    throw new AppError({
      code: "INVALID_VIRTUAL_TRY_ON_DATA",
      message: "El tamaño recibido no coincide con el archivo declarado.",
      status: 400,
    });
  }

  return (dependencies.replaceActiveAsset ?? replaceActiveVirtualTryOnAsset)(
    product.id,
    {
      data,
      filename: input.image.filename,
      mediaType: input.image.mediaType,
      notes: input.notes,
      rotationOffsetDegrees: input.rotationOffsetDegrees,
      sha256: createHash("sha256").update(data).digest("hex"),
      size: data.length,
      verticalOffset: input.verticalOffset,
      widthScale: input.widthScale,
    },
    actor.userId,
  );
}

export async function getVirtualTryOnAssetHistory(productId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_READ]);
  const product = await getFrameProduct(productId, dependencies);
  const items = await (dependencies.listAssetVersions ?? listVirtualTryOnAssetVersions)(
    product.id,
  );
  return { items, product };
}

export async function deactivateVirtualTryOnAsset(productId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  const product = await getFrameProduct(productId, dependencies);
  const asset = await (dependencies.retireActiveAsset ?? retireActiveVirtualTryOnAsset)(
    product.id,
    actor.userId,
  );
  if (!asset) assetNotFound();
  return asset;
}

export async function getPublicVirtualTryOnFrames(dependencies = {}) {
  return (dependencies.listActiveFrames ?? listActiveVirtualTryOnFrames)();
}

export async function getPublicVirtualTryOnAssetFile(assetId, dependencies = {}) {
  const file = await (dependencies.findPublicAssetFile ?? findPublicVirtualTryOnAssetFile)(
    validateVirtualTryOnAssetId(assetId),
  );
  if (!file) assetNotFound();
  return file;
}
