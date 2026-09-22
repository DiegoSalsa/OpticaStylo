import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con product-image-repository.

// Centralizar la lógica de imagen para mantener consistente el comportamiento de la aplicación
function image(row) {
  if (!row) return null;
  return {
    alt: row.alt_text, assetId: row.cloudinary_asset_id, createdAt: row.created_at,
    filename: row.original_filename, format: row.cloudinary_format, height: row.height,
    id: row.id, mediaType: row.media_type, position: Number(row.position),
    publicId: row.cloudinary_public_id, sha256: row.file_sha256,
    size: Number(row.file_size_bytes), status: row.status, url: row.cloudinary_url,
    version: Number(row.cloudinary_version), width: row.width,
  };
}

// Consultar list active producto imágenes y devolver los datos en el formato esperado por la capa llamadora
export async function listActiveProductImages(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];
  const rows = await prisma.product_images.findMany({
    orderBy: [{ product_id: "asc" }, { position: "asc" }, { id: "asc" }],
    where: { product_id: { in: productIds }, status: "ACTIVE" },
  });
  return rows.map((row) => ({ productId: row.product_id, ...image(row) }));
}

// Consultar find active producto imagen y devolver los datos en el formato esperado por la capa llamadora
export async function findActiveProductImage(productId, imageId) {
  return image(await prisma.product_images.findFirst({
    where: { id: imageId, product_id: productId, status: "ACTIVE" },
  }));
}

// Crear o registrar create producto imagen aplicando las reglas de negocio y persistencia correspondientes
export async function createProductImage(productId, input, actorUserId) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    const product = await client.products.findUnique({ select: { id: true }, where: { id: productId } });
    if (!product) return null;
    const maximum = await client.product_images.aggregate({
      _max: { position: true }, where: { product_id: productId, status: "ACTIVE" },
    });
    const position = (maximum._max.position ?? -1) + 1;
    if (position > 99) return { reason: "IMAGE_LIMIT_REACHED" };
    const created = await client.product_images.create({ data: {
      alt_text: input.alt, cloudinary_asset_id: input.assetId,
      cloudinary_format: input.format, cloudinary_public_id: input.publicId,
      cloudinary_url: input.url, cloudinary_version: input.version,
      created_by: actorUserId, file_sha256: input.sha256,
      file_size_bytes: input.size, height: input.height, media_type: input.mediaType,
      original_filename: input.filename, position, product_id: productId, width: input.width,
    } });
    // Registrar el evento de dominio para conservar la trazabilidad histórica de la operación
    await client.product_events.create({ data: {
      changed_fields: ["images"], event_type: "IMAGE_ADDED",
      performed_by: actorUserId, product_id: productId,
    } });
    return { image: image(created), reason: null };
  // Usar aislamiento serializable para reducir conflictos entre operaciones concurrentes
  }, { isolationLevel: "Serializable" });
}

// Centralizar la lógica de retire producto imagen para mantener consistente el comportamiento de la aplicación
export async function retireProductImage(productId, imageId, actorUserId) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    const updated = await client.product_images.updateMany({
      data: { retired_at: new Date(), retired_by: actorUserId, status: "RETIRED" },
      where: { id: imageId, product_id: productId, status: "ACTIVE" },
    });
    if (updated.count !== 1) return null;
    const retired = await client.product_images.findUnique({ where: { id: imageId } });
    // Registrar el evento de dominio para conservar la trazabilidad histórica de la operación
    await client.product_events.create({ data: {
      changed_fields: ["images"], event_type: "IMAGE_RETIRED",
      performed_by: actorUserId, product_id: productId,
    } });
    return image(retired);
  });
}
