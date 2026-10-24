import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadProjectEnvironment } from "./load-environment.mjs";
import { createProduct, updateProduct } from "../src/services/product-service.js";
import { addProductImage } from "../src/services/product-image-service.js";
import { findProductById } from "../src/repositories/product-repository.js";
import { downloadProductImage } from "../src/integrations/media/product-image-downloader.js";
import { validateProductImageBytes } from "../src/validations/product-image-validation.js";
import { readImageDimensions } from "../src/validations/image-dimensions.js";
import { prisma } from "../src/db/prisma.js";
import { productImageActor } from "./product-image-actor.mjs";

loadProjectEnvironment();
const { values } = parseArgs({ options: {
  inventory: { type: "string" }, manifest: { type: "string" }, actor: { type: "string" },
  apply: { type: "boolean", default: false }, "allow-production": { type: "boolean", default: false },
  "expected-cloud": { type: "string" }, "expected-database-host": { type: "string" },
  output: { type: "string", default: "tmp/romano-images/published-products.json" },
} });
if (!values.inventory || !values.manifest || !values.actor) throw new Error("Indicar --inventory, --manifest y --actor.");
const databaseUrl = new URL(process.env.DATABASE_URL);
const production = !["127.0.0.1", "localhost"].includes(databaseUrl.hostname);
if (values.apply && (production && !values["allow-production"])) throw new Error("La publicación productiva requiere --allow-production.");
if (values.apply && values["expected-database-host"] !== databaseUrl.hostname) throw new Error("El host de BD confirmado no coincide.");
if (values.apply && values["expected-cloud"] !== process.env.CLOUDINARY_CLOUD_NAME) throw new Error("La cuenta Cloudinary confirmada no coincide.");
const actor = await productImageActor(values.actor);
const inventory = JSON.parse(await readFile(values.inventory, "utf8"));
const manifest = JSON.parse(await readFile(values.manifest, "utf8"));
if (inventory.workbookSha256 !== manifest.workbookSha256) throw new Error("El manifiesto no corresponde al Excel.");
const variants = new Map(inventory.variants.map((item) => [item.key, item]));
const groups = new Map();
for (const candidate of manifest.candidates) {
  const variant = variants.get(candidate.inventoryKey);
  const prices = [...new Set((variant?.rows ?? []).map((row) => row.confirmedPriceClp).filter((price) => price != null))];
  if (!variant || prices.length !== 1 || !variant.color || candidate.width < 600 || candidate.height < 200) continue;
  const list = groups.get(candidate.inventoryKey) ?? [];
  if (list.length < 4) list.push({ candidate, variant, price: prices[0] });
  groups.set(candidate.inventoryKey, list);
}
const results = [];
for (const [inventoryKey, group] of groups) {
  const { variant, price } = group[0];
  const input = { category: "FRAME", name: `${variant.brand} ${variant.model} ${variant.color}`, sku: `ROM-${variant.id.toUpperCase()}`, unitPriceCents: price, requiresPrescription: false };
  let product = await prisma.products.findUnique({ where: { sku: input.sku } });
  if (!product) {
    if (!values.apply) { results.push({ inventoryKey, status: "READY_DRY_RUN", input, images: group.length }); continue; }
    product = await createProduct(input, actor);
  } else {
    product = await findProductById(product.id);
    if (values.apply) product = await updateProduct(product.id, { ...input, isActive: true }, actor);
  }
  if (!values.apply) { results.push({ inventoryKey, status: "READY_DRY_RUN", productId: product.id, images: group.length }); continue; }
  const imageResults = [];
  for (const { candidate } of group) {
    const downloaded = await downloadProductImage(candidate.sourceImageUrl, { allowedHosts: manifest.allowedImageHosts });
    const data = validateProductImageBytes(downloaded.data, downloaded.mediaType);
    const dimensions = readImageDimensions(data, downloaded.mediaType);
    if (!dimensions || dimensions.width < 600 || dimensions.height < 200) throw new Error(`Resolución insuficiente para ${candidate.id}.`);
    const provenance = {
      identity: candidate.identity, sourceUrl: candidate.sourceUrl, sourceImageUrl: candidate.sourceImageUrl,
      view: candidate.view ?? "CATALOGUE_VIEW", workbookSha256: inventory.workbookSha256, inventoryRows: variant.rows,
      authorization: { status: "USER_PUBLISHED_PENDING_RIGHTS", commercialUse: false, holder: "Publicación explícita de Óptica Stylo; titular de derechos pendiente de confirmar", evidenceUrl: candidate.sourceUrl, scope: "Publicar en el catálogo Óptica Stylo mientras se documenta el permiso del titular." },
      verification: { status: "EXACT_CODE_CANDIDATE", colorConfirmed: true, reviewedAt: new Date().toISOString(), reviewedBy: "Publicación autorizada por el solicitante; revisión visual final y derechos pendientes", evidenceUrl: candidate.sourceUrl },
    };
    const file = new File([data], `${variant.id}.${downloaded.mediaType.split("/")[1]}`, { type: downloaded.mediaType });
    const image = await addProductImage(product.id, { alt: candidate.alt, file, provenance }, actor);
    imageResults.push({ candidateId: candidate.id, status: image.duplicate ? "ALREADY_ASSOCIATED" : "ASSOCIATED", imageId: image.id, assetId: image.assetId, publicId: image.publicId, url: image.url, sha256: image.sha256 });
  }
  results.push({ inventoryKey, productId: product.id, sku: product.sku, name: product.name, priceClp: price, status: "PUBLISHED", images: imageResults });
}
const summary = { dryRun: !values.apply, databaseHost: databaseUrl.hostname, cloudinary: process.env.CLOUDINARY_CLOUD_NAME, groups: results.length, plannedProducts: results.length, plannedImages: results.reduce((total, item) => total + (Array.isArray(item.images) ? item.images.length : Number(item.images ?? 0)), 0), publishedProducts: results.filter((item) => item.status === "PUBLISHED").length, associatedImages: results.reduce((total, item) => total + (Array.isArray(item.images) ? item.images.length : 0), 0), results };
await mkdir(path.dirname(values.output), { recursive: true });
await writeFile(values.output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, results: undefined }));
await prisma.$disconnect();
