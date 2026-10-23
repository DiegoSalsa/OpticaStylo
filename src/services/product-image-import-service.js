import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { inventoryKey } from "../integrations/inventory/romano-image-inventory.js";
import { downloadProductImage } from "../integrations/media/product-image-downloader.js";
import { validateImageProvenance } from "../validations/product-image-provenance.js";
import { validateProductImageAlt, validateProductImageBytes } from "../validations/product-image-validation.js";
import { readImageDimensions } from "../validations/image-dimensions.js";
import { addProductImage } from "./product-image-service.js";
import { requirePermissions } from "../auth/require-permission.js";
import { PERMISSIONS } from "../auth/permissions.js";

const retryable = new Set(["MEDIA_STORAGE_UNAVAILABLE", "PRODUCT_IMAGE_ASSOCIATION_UNCERTAIN", "SOURCE_RATE_LIMITED", "SOURCE_UNAVAILABLE", "ABORT_ERR", "P2034", "P2002", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "P1001", "P1002", "P1017"]);
async function retry(operation, { wait, attempts = 3 }) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); } catch (error) {
      if (attempt + 1 >= attempts || !(retryable.has(error.code) || error.name === "TimeoutError")) throw error;
      await wait(Math.max(500 * 2 ** attempt, Math.min(30000, error.retryAfterMs ?? 0)));
    }
  }
}

export async function importProductImages({ manifest, inventory, actor, dryRun = true, batchSize = 25, offset = 0, concurrency = 2 }, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("El tamaño de lote, el desplazamiento o la concurrencia no son válidos.");
  if (manifest.workbookSha256 !== inventory.workbookSha256 || !Array.isArray(manifest.candidates)) throw new Error("El manifiesto no corresponde al archivo maestro.");
  const append = dependencies.appendEvent ?? (async () => {});
  const wait = dependencies.wait ?? delay;
  const variants = new Map(inventory.variants.map((item) => [item.key, item]));
  const groupKey = (candidate) => candidate.mapping?.productId ?? candidate.inventoryKey;
  const seenGroups = new Set(); let previousGroup;
  const previousOrders = new Map(); const productIdentities = new Map();
  for (const candidate of manifest.candidates) {
    const key = groupKey(candidate);
    if (candidate.mapping?.productId) {
      if (productIdentities.has(key) && productIdentities.get(key) !== candidate.inventoryKey) throw new Error("Un producto no puede recibir fotografías de variantes diferentes.");
      productIdentities.set(key, candidate.inventoryKey);
    }
    if (key !== previousGroup && seenGroups.has(key)) throw new Error("Agrupar consecutivamente todas las vistas de cada producto en el manifiesto.");
    seenGroups.add(key); previousGroup = key;
    if (candidate.authorization?.status === "AUTHORIZED") {
      const expected = (previousOrders.get(key) ?? -1) + 1;
      if (candidate.galleryOrder !== expected) throw new Error("Las vistas autorizadas deben indicar galleryOrder consecutivo desde cero, empezando por la principal.");
      previousOrders.set(key, candidate.galleryOrder);
    }
  }
  if (offset > 0 && offset < manifest.candidates.length && groupKey(manifest.candidates[offset - 1]) === groupKey(manifest.candidates[offset])) throw new Error("El lote debe comenzar con la galería completa de un producto.");
  let end = Math.min(offset + batchSize, manifest.candidates.length);
  while (end < manifest.candidates.length && end > offset && groupKey(manifest.candidates[end - 1]) === groupKey(manifest.candidates[end])) end -= 1;
  if (end === offset && offset < manifest.candidates.length) throw new Error("Aumentar el lote para incluir al menos una galería completa.");
  const candidates = manifest.candidates.slice(offset, end);
  const queues = new Map(); const failedProducts = new Set();
  const results = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor++;
      const candidate = candidates[index];
      const key = groupKey(candidate);
      const previous = queues.get(key) ?? Promise.resolve();
      let release;
      queues.set(key, new Promise((resolve) => { release = resolve; }));
      await previous;
      const result = { candidateId: candidate.id, inventoryKey: candidate.inventoryKey, dryRun };
      try {
        const variant = variants.get(candidate.inventoryKey);
        if (!variant || !variant.color || candidate.inventoryKey !== inventoryKey(candidate.identity ?? {})) throw new Error("La marca, el modelo o el color no coinciden con el Excel.");
        if (!candidate.mapping?.productId || !candidate.mapping.productSku || !candidate.mapping.productName || candidate.mapping.inventoryKey !== variant.key || candidate.mapping.status !== "VERIFIED") {
          result.status = "PENDING_PRODUCT_MAPPING";
        } else if (candidate.authorization?.status !== "AUTHORIZED") {
          result.status = "PENDING_AUTHORIZATION";
        } else {
          if (failedProducts.has(key)) throw new Error("Una vista anterior falló; reintentar la galería completa antes de continuar.");
          const provenance = validateImageProvenance({ ...candidate, workbookSha256: inventory.workbookSha256, inventoryRows: variant.rows });
          const alt = validateProductImageAlt(candidate.alt);
          const product = await dependencies.findProduct(candidate.mapping.productId);
          if (!product || product.sku !== candidate.mapping.productSku || product.name !== candidate.mapping.productName || product.category !== "FRAME") throw new Error("La correspondencia revisada no coincide con el producto actual de la base de datos.");
          const downloaded = await retry(() => (dependencies.download ?? downloadProductImage)(candidate.sourceImageUrl, { allowedHosts: manifest.allowedImageHosts }), { wait });
          const data = validateProductImageBytes(downloaded.data, downloaded.mediaType);
          const dimensions = readImageDimensions(data, downloaded.mediaType);
          if (!dimensions || dimensions.width < 600 || dimensions.height < 200) throw new Error("La fotografía no alcanza la resolución mínima de 600 × 200 píxeles.");
          const sha256 = createHash("sha256").update(data).digest("hex");
          if (candidate.sha256 !== sha256) throw new Error("El hash no coincide con la fotografía revisada.");
          const importKey = createHash("sha256").update(`${product.id}|${sha256}`).digest("hex");
          Object.assign(result, { productId: product.id, sha256, publicId: `opticastylo/productos/romano-${importKey}` });
          if (dryRun) result.status = "READY_DRY_RUN";
          else {
            // Escribir antes de la red permite reconciliar una interrupción, incluso con respuesta perdida.
            await append({ ...result, status: "STARTED", at: new Date().toISOString() });
            const file = new File([data], `${variant.id}.${downloaded.mediaType.split("/")[1]}`, { type: downloaded.mediaType });
            const image = await retry(() => (dependencies.addImage ?? addProductImage)(product.id, { alt, file, provenance }, actor), { wait });
            Object.assign(result, { status: image.status === "RETIRED" ? "PREVIOUSLY_RETIRED" : image.duplicate ? "ALREADY_ASSOCIATED" : "ASSOCIATED", imageId: image.id, assetId: image.assetId, publicId: image.publicId, url: image.url });
          }
        }
      } catch (error) {
        if (candidate.authorization?.status === "AUTHORIZED") failedProducts.add(key);
        result.status = error.code === "SOURCE_IMAGE_NOT_FOUND" ? "IMAGE_NOT_FOUND" : "TECHNICAL_ERROR";
        // Los informes conservan códigos; los errores de proveedores pueden contener credenciales o URLs firmadas.
        result.error = error.code ?? "VALIDATION_OR_SOURCE_ERROR";
        if (error.code === "PRODUCT_IMAGE_CLEANUP_REQUIRED") result.cleanupRequired = true;
        if (error.code === "PRODUCT_IMAGE_ASSOCIATION_UNCERTAIN") result.reconciliationRequired = true;
      }
      results[index] = result;
      try { await append({ ...result, at: new Date().toISOString() }); } finally { release(); }
      await wait(250);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return { dryRun, offset, nextOffset: offset + candidates.length, totalCandidates: manifest.candidates.length, results };
}
