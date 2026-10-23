import { createHash } from "node:crypto";

import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { getCloudinaryMediaGateway } from "../integrations/media/cloudinary-media-gateway.js";
import {
  createProductImage,
  findActiveProductImage,
  findProductImageByHash,
  listActiveProductImages,
  retireProductImage,
} from "../repositories/product-image-repository.js";
import { findProductById } from "../repositories/product-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateProductId } from "../validations/product-validation.js";
import { validateImageProvenance } from "../validations/product-image-provenance.js";
import {
  validateProductImage,
  validateProductImageAlt,
  validateProductImageBytes,
} from "../validations/product-image-validation.js";

function notFound() {
  throw new AppError({ code: "PRODUCT_IMAGE_NOT_FOUND", message: "No se encontró la imagen del producto.", status: 404 });
}

function grouped(images) {
  return images.map((image) => ({
    alt: image.alt,
    assetId: image.assetId,
    createdAt: image.createdAt,
    filename: image.filename,
    format: image.format,
    height: image.height,
    id: image.id,
    mediaType: image.mediaType,
    position: image.position,
    publicId: image.publicId,
    sha256: image.sha256,
    size: image.size,
    status: image.status,
    url: image.url,
    version: image.version,
    width: image.width,
    provenance: image.provenance ?? null,
  }));
}

export async function getProductImages(productId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_READ]);
  const id = validateProductId(productId);
  const product = await (dependencies.findProductById ?? findProductById)(id);
  if (!product) notFound();
  return grouped(await (dependencies.listImages ?? listActiveProductImages)([id]));
}

export async function addProductImage(productId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  const id = validateProductId(productId);
  const product = await (dependencies.findProductById ?? findProductById)(id);
  if (!product) notFound();
  const image = validateProductImage(input.file);
  const alt = validateProductImageAlt(input.alt);
  const provenance = validateImageProvenance(input.provenance);
  const data = validateProductImageBytes(
    Buffer.from(await image.file.arrayBuffer()),
    image.mediaType,
  );
  const sha256 = createHash("sha256").update(data).digest("hex");
  const findDuplicate = dependencies.findDuplicate ?? findProductImageByHash;
  const duplicate = await findDuplicate(id, sha256);
  if (duplicate) return { ...duplicate, duplicate: true };
  const importKey = provenance ? createHash("sha256").update(`${id}|${sha256}`).digest("hex") : null;
  const uploader = dependencies.mediaGateway ?? getCloudinaryMediaGateway();
  const stored = await uploader.uploadPublicProductImage({
    data, ...(importKey ? { publicId: `romano-${importKey}`, sha256, productId: id } : {}),
  });
  try {
    const result = await (dependencies.createImage ?? createProductImage)(id, {
      alt,
      assetId: stored.assetId,
      filename: image.filename,
      format: stored.format,
      height: stored.height,
      mediaType: image.mediaType,
      publicId: stored.publicId,
      sha256, importKey, provenance,
      size: data.length,
      url: stored.secureUrl,
      version: stored.version,
      width: stored.width,
    }, actor.userId);
    if (result?.reason === "IMAGE_LIMIT_REACHED") {
      throw new AppError({ code: "PRODUCT_IMAGE_LIMIT_REACHED", message: "El producto ya tiene el máximo de imágenes permitido.", status: 409 });
    }
    if (!result?.image) notFound();
    if (result.reason === "DUPLICATE" && result.image.publicId !== stored.publicId) {
      const cleaned = await uploader.deletePublicProductImage(stored);
      if (!cleaned) throw new AppError({ code: "PRODUCT_IMAGE_CLEANUP_REQUIRED", message: "La imagen duplicada requiere limpieza en Cloudinary.", status: 503 });
    }
    return { ...result.image, duplicate: result.reason === "DUPLICATE" };
  } catch (error) {
    // Una respuesta perdida puede ocultar una transacción confirmada: comprobar antes de compensar.
    let persisted;
    try { persisted = await findDuplicate(id, sha256); } catch {
      throw new AppError({ code: "PRODUCT_IMAGE_ASSOCIATION_UNCERTAIN", message: "No se pudo confirmar la asociación; conservar el recurso y reintentar.", status: 503, cause: error });
    }
    if (persisted?.assetId === stored.assetId) return { ...persisted, duplicate: true };
    // Un identificador de importación es compartido por los reintentos: conservarlo hasta reconciliar.
    if (importKey && !persisted) {
      throw new AppError({ code: "PRODUCT_IMAGE_ASSOCIATION_UNCERTAIN", message: "Conservar el recurso de importación para reintentar o reconciliar su asociación.", status: 503, cause: error });
    }
    const cleaned = await uploader.deletePublicProductImage(stored);
    if (!cleaned) throw new AppError({ code: "PRODUCT_IMAGE_CLEANUP_REQUIRED", message: "La asociación falló y el recurso requiere limpieza en Cloudinary.", status: 503, cause: error });
    throw error;
  }
}

// Eliminar o cancelar remove producto imagen de forma controlada y consistente
export async function removeProductImage(productId, imageId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  const id = validateProductId(productId);
  const current = await (dependencies.findImage ?? findActiveProductImage)(id, imageId);
  if (!current) notFound();
  const retired = await (dependencies.retireImage ?? retireProductImage)(id, imageId, actor.userId);
  if (!retired) notFound();
  const removed = await (dependencies.mediaGateway ?? getCloudinaryMediaGateway())
    .deletePublicProductImage(current);
  if (!removed) {
    console.error("La imagen retirada requiere eliminación manual en Cloudinary.", current.assetId);
  }
  return retired;
}
