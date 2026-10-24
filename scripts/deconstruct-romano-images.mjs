import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { loadProjectEnvironment } from "./load-environment.mjs";
import { addProductImage, removeProductImage } from "../src/services/product-image-service.js";
import { prisma } from "../src/db/prisma.js";
import { productImageActor } from "./product-image-actor.mjs";

loadProjectEnvironment();

const { values } = parseArgs({ options: {
  actor: { type: "string", default: "e1a71e8b-53d0-4b87-a843-e02566cb50fb" },
  apply: { type: "boolean", default: false },
  "allow-production": { type: "boolean", default: false },
  "expected-cloud": { type: "string" },
  "expected-database-host": { type: "string" },
  candidates: { type: "string", default: "docs/romano-images/2026-10-22/candidates.json" },
  published: { type: "string", default: "docs/romano-images/2026-10-22/published-production.json" },
  output: { type: "string", default: "tmp/romano-images/deconstructed-production.json" },
  "preview-dir": { type: "string" },
} });

const databaseUrl = new URL(process.env.DATABASE_URL);
const production = !["127.0.0.1", "localhost"].includes(databaseUrl.hostname);
if (values.apply && production && !values["allow-production"]) {
  throw new Error("La actualización productiva requiere --allow-production.");
}
if (values.apply && values["expected-database-host"] && values["expected-database-host"] !== databaseUrl.hostname) {
  throw new Error("El host de BD confirmado no coincide.");
}
if (values.apply && values["expected-cloud"] && values["expected-cloud"] !== process.env.CLOUDINARY_CLOUD_NAME) {
  throw new Error("La cuenta Cloudinary confirmada no coincide.");
}

const candidatesDocument = JSON.parse(await readFile(values.candidates, "utf8"));
const publishedDocument = JSON.parse(await readFile(values.published, "utf8"));
const candidates = new Map(candidatesDocument.candidates.map((candidate) => [candidate.id, candidate]));
const actor = values.apply ? await productImageActor(values.actor) : null;

function round(value) {
  return Math.max(0, Math.round(value));
}

function clampCrop(crop, width, height) {
  const left = Math.min(round(crop.left), width - 1);
  const top = Math.min(round(crop.top), height - 1);
  const right = Math.min(width, left + Math.max(1, round(crop.width)));
  const bottom = Math.min(height, top + Math.max(1, round(crop.height)));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function cropPlan(identity, width, height) {
  const model = String(identity.model).toUpperCase();
  // LT1000 has clean frontal and diagonal files already; only its two
  // catalogue collages need splitting into the optical frame and its clips.
  if (model === "LT1000") {
    const row = round(height * 0.62);
    return [
      { key: "OPTICAL_FRONT", view: "FRONTAL_CROP", crop: { left: 0, top: 0, width, height: row } },
      { key: "CLIP_DARK", view: "CLIP_DARK_CROP", crop: { left: width * 0.03, top: row, width: width * 0.46, height: height - row } },
      { key: "CLIP_YELLOW", view: "CLIP_YELLOW_CROP", crop: { left: width * 0.51, top: row, width: width * 0.46, height: height - row } },
    ];
  }

  const hasTopClip = ["LT1001", "LT1002", "LT1003"].includes(model);
  if (hasTopClip) {
    const profile = {
      LT1001: { topLeft: 0.28, topWidth: 0.66, topEnd: 0.35, middleStart: 0.40, middleEnd: 0.70, bottomStart: 0.75 },
      LT1002: { topLeft: 0.31, topWidth: 0.65, topEnd: 0.33, middleStart: 0.37, middleEnd: 0.68, bottomStart: 0.72 },
      LT1003: { topLeft: 0.27, topWidth: 0.68, topEnd: 0.37, middleStart: 0.39, middleEnd: 0.69, bottomStart: 0.75 },
    }[model];
    const topEnd = round(height * profile.topEnd);
    const middleStart = round(height * profile.middleStart);
    const middleEnd = round(height * profile.middleEnd);
    const bottomStart = round(height * profile.bottomStart);
    return [
      { key: "OPTICAL_FRONT", view: "FRONTAL_CROP", crop: { left: 0, top: middleStart, width, height: middleEnd - middleStart } },
      { key: "CLIP_TOP", view: "FRONTAL_CLIP_CROP", crop: { left: width * profile.topLeft, top: 0, width: width * profile.topWidth, height: topEnd } },
      { key: "CLIP_DARK", view: "CLIP_DARK_CROP", crop: { left: width * 0.05, top: bottomStart, width: width * 0.45, height: height - bottomStart } },
      { key: "CLIP_YELLOW", view: "CLIP_YELLOW_CROP", crop: { left: width * 0.51, top: bottomStart, width: width * 0.45, height: height - bottomStart } },
    ];
  }

  const profile = {
    LT1004: { middleStart: 0.32, middleEnd: 0.70, bottomStart: 0.73 },
    LT1005: { middleStart: 0.38, middleEnd: 0.72, bottomStart: 0.75 },
    LT1008: { middleStart: 0.38, middleEnd: 0.72, bottomStart: 0.75 },
    LT1009: { middleStart: 0.34, middleEnd: 0.72, bottomStart: 0.75 },
    LT1010: { middleStart: 0.34, middleEnd: 0.70, bottomStart: 0.75 },
  }[model] ?? { middleStart: 0.34, middleEnd: 0.74, bottomStart: 0.75 };
  const middleStart = round(height * profile.middleStart);
  const middleEnd = round(height * profile.middleEnd);
  const bottomStart = round(height * profile.bottomStart);
  return [
    { key: "OPTICAL_FRONT", view: "FRONTAL_CROP", crop: { left: 0, top: middleStart, width, height: middleEnd - middleStart } },
    { key: "CLIP_DARK", view: "CLIP_DARK_CROP", crop: { left: width * 0.05, top: bottomStart, width: width * 0.45, height: height - bottomStart } },
    { key: "CLIP_YELLOW", view: "CLIP_YELLOW_CROP", crop: { left: width * 0.51, top: bottomStart, width: width * 0.45, height: height - bottomStart } },
  ];
}

function isInk(r, g, b) {
  return Math.min(r, g, b) < 242 || Math.max(r, g, b) - Math.min(r, g, b) > 16;
}

// Remove catalogue labels from the selected row without changing the frame.
// The frames are large connected components; labels and logos are small ones.
async function cleanCrop(input, rawCrop) {
  const metadata = await sharp(input).metadata();
  const crop = clampCrop(rawCrop, metadata.width, metadata.height);
  const { data, info } = await sharp(input).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const ink = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    ink[i] = isInk(data[offset], data[offset + 1], data[offset + 2]) ? 1 : 0;
  }
  const visited = new Uint8Array(pixelCount);
  const component = new Int32Array(pixelCount);
  const keep = new Uint8Array(pixelCount);
  let componentId = 0;
  const sizes = [];
  const neighbors = [-1, 0, 1];
  for (let start = 0; start < pixelCount; start += 1) {
    if (!ink[start] || visited[start]) continue;
    componentId += 1;
    const queue = [start];
    visited[start] = 1;
    let size = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component[current] = componentId;
      size += 1;
      const x = current % info.width;
      const y = Math.floor(current / info.width);
      for (const dy of neighbors) for (const dx of neighbors) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue;
        const next = ny * info.width + nx;
        if (ink[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    sizes[componentId] = size;
  }
  const minimum = Math.max(700, Math.floor(pixelCount * 0.0009));
  for (let i = 0; i < pixelCount; i += 1) if (sizes[component[i]] >= minimum) keep[i] = 1;
  for (let i = 0; i < pixelCount; i += 1) if (!keep[i]) {
    const offset = i * 4;
    data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255; data[offset + 3] = 255;
  }
  return sharp(data, { raw: info }).trim({ background: { r: 255, g: 255, b: 255, alpha: 255 }, threshold: 12 })
    .extend({ top: 18, bottom: 18, left: 18, right: 18, background: { r: 255, g: 255, b: 255, alpha: 255 } })
    .webp({ quality: 94, effort: 6 }).toBuffer();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function provenance(candidate, variant, view) {
  return {
    identity: candidate.identity,
    sourceUrl: candidate.sourceUrl,
    sourceImageUrl: candidate.sourceImageUrl,
    view,
    workbookSha256: candidatesDocument.workbookSha256,
    inventoryRows: variant?.rows ?? [],
    authorization: {
      status: "USER_PUBLISHED_PENDING_RIGHTS",
      commercialUse: false,
      holder: "Publicación explícita de Óptica Stylo; titular de derechos pendiente de confirmar",
      evidenceUrl: candidate.sourceUrl,
      scope: "Publicar en el catálogo Óptica Stylo mientras se documenta el permiso del titular.",
    },
    verification: {
      status: "EXACT_CODE_CANDIDATE",
      colorConfirmed: true,
      reviewedAt: new Date().toISOString(),
      reviewedBy: "Revisión visual: recorte de vista de producto desde fuente oficial",
      evidenceUrl: candidate.sourceUrl,
    },
  };
}

const inventoryDocumentPath = "docs/romano-images/2026-10-22/inventory.json";
let inventory = { variants: [] };
try { inventory = JSON.parse(await readFile(inventoryDocumentPath, "utf8")); } catch { /* publication metadata is enough for a safe retry */ }
const variants = new Map((inventory.variants ?? []).map((item) => [item.key, item]));

const plans = [];
for (const result of publishedDocument.results ?? []) {
  const [brand, model, color] = String(result.inventoryKey).split("|");
  if (brand !== "LAVANETT") continue;
  for (const image of result.images ?? []) {
    const candidate = candidates.get(image.candidateId);
    if (!candidate) continue;
    const sourceUrl = String(candidate.sourceImageUrl).toLowerCase();
    const composite = model !== "LT1000" || /imagen-2[-_]/.test(sourceUrl);
    if (!composite) continue;
    plans.push({ inventoryKey: result.inventoryKey, productId: result.productId, image, candidate, identity: { brand, model, color } });
  }
}

// Prüne Rosalba currently starts with a lifestyle photo and a case photo. Replace
// those two gallery items with the official front and diagonal product views.
const pruneResult = (publishedDocument.results ?? []).find((result) => result.inventoryKey === "PRUNE|ROSALBA|9");
const pruneCandidates = (candidatesDocument.candidates ?? []).filter((candidate) => candidate.identity?.brand === "PRUNE" && candidate.identity?.model === "ROSALBA" && String(candidate.identity?.color) === "9");
if (pruneResult && pruneCandidates.length) {
  for (const image of pruneResult.images ?? []) {
    const candidate = candidates.get(image.candidateId);
    if (candidate && ["catalogue-1eb1dfdddb6be34d7a56", "catalogue-2c647834efd43fe8d06a"].includes(candidate.id)) {
      plans.push({ inventoryKey: pruneResult.inventoryKey, productId: pruneResult.productId, image, candidate, prune: true, identity: candidate.identity });
    }
  }
  for (const candidate of pruneCandidates.filter((item) => ["catalogue-a5c4cf6f1b1d69f30be8", "catalogue-f868a8bcea4aec4466d8"].includes(item.id))) {
    plans.push({ inventoryKey: pruneResult.inventoryKey, productId: pruneResult.productId, candidate, pruneReplacement: true, identity: candidate.identity });
  }
}

const output = { dryRun: !values.apply, databaseHost: databaseUrl.hostname, cloudinary: process.env.CLOUDINARY_CLOUD_NAME, plans: [] };
if (values["preview-dir"]) await mkdir(values["preview-dir"], { recursive: true });
for (const plan of plans) {
  const candidate = plan.candidate;
  const source = await fetchBuffer(candidate.sourceImageUrl);
  if (plan.pruneReplacement) {
    if (values.apply) {
      const activeImages = await prisma.product_images.findMany({ where: { product_id: plan.productId, status: "ACTIVE" }, select: { provenance: true } });
      if (activeImages.some((image) => image.provenance?.sourceImageUrl === candidate.sourceImageUrl)) {
        output.plans.push({ action: "ADD", inventoryKey: plan.inventoryKey, productId: plan.productId, candidateId: candidate.id, status: "ALREADY_ASSOCIATED" });
        continue;
      }
    }
    const image = await sharp(source).webp({ quality: 94, effort: 6 }).toBuffer();
    const item = { action: "ADD", inventoryKey: plan.inventoryKey, productId: plan.productId, candidateId: candidate.id, view: candidate.id.endsWith("be8") ? "FRONTAL_CROP" : "DIAGONAL_CROP", width: (await sharp(image).metadata()).width, height: (await sharp(image).metadata()).height };
    if (values["preview-dir"]) await writeFile(path.join(values["preview-dir"], `${plan.inventoryKey.replaceAll("|", "-")}-${item.view.toLowerCase()}.webp`), image);
    if (values.apply) {
      const variant = variants.get(plan.inventoryKey);
      const file = new File([image], `${candidate.id}.webp`, { type: "image/webp" });
      const stored = await addProductImage(plan.productId, { alt: `${candidate.identity.brand} ${candidate.identity.model} ${candidate.identity.color} ${item.view.toLowerCase()}`, file, provenance: provenance(candidate, variant, item.view) }, actor);
      item.imageId = stored.id; item.url = stored.url; item.status = stored.duplicate ? "ALREADY_ASSOCIATED" : "ASSOCIATED";
    }
    output.plans.push(item);
    continue;
  }
  if (plan.prune) {
    const item = { action: "RETIRE", inventoryKey: plan.inventoryKey, productId: plan.productId, imageId: plan.image.id, candidateId: candidate.id, reason: candidate.id.startsWith("catalogue-1eb") ? "LIFESTYLE_PHOTO" : "CASE_PHOTO" };
    if (values.apply) { await removeProductImage(plan.productId, plan.image.imageId, actor); item.status = "RETIRED"; }
    output.plans.push(item);
    continue;
  }
  const metadata = await sharp(source).metadata();
  const variant = variants.get(plan.inventoryKey);
  if (values.apply) {
    // Retire the collage first so the first new position is the clean frontal crop
    // for products that only had this catalogue file.
    await removeProductImage(plan.productId, plan.image.imageId, actor);
    output.plans.push({ action: "RETIRE", inventoryKey: plan.inventoryKey, productId: plan.productId, imageId: plan.image.imageId, candidateId: candidate.id, status: "RETIRED" });
  }
  for (const cropSpec of cropPlan(plan.identity, metadata.width, metadata.height)) {
    const image = await cleanCrop(source, cropSpec.crop);
    const croppedMetadata = await sharp(image).metadata();
    const item = { action: "REPLACE_WITH_CROP", inventoryKey: plan.inventoryKey, productId: plan.productId, oldImageId: plan.image.imageId, candidateId: candidate.id, view: cropSpec.view, width: croppedMetadata.width, height: croppedMetadata.height };
    if (values["preview-dir"]) await writeFile(path.join(values["preview-dir"], `${plan.inventoryKey.replaceAll("|", "-")}-${candidate.id.slice(-6)}-${cropSpec.key.toLowerCase()}.webp`), image);
    if (values.apply) {
      const file = new File([image], `${candidate.id}-${cropSpec.key.toLowerCase()}.webp`, { type: "image/webp" });
      const stored = await addProductImage(plan.productId, { alt: `${candidate.identity.brand} ${candidate.identity.model} ${candidate.identity.color} ${cropSpec.view.toLowerCase()}`, file, provenance: provenance(candidate, variant, cropSpec.view) }, actor);
      item.imageId = stored.id; item.url = stored.url; item.status = stored.duplicate ? "ALREADY_ASSOCIATED" : "ASSOCIATED";
    }
    output.plans.push(item);
  }
}

await mkdir(path.dirname(values.output), { recursive: true });
await writeFile(values.output, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ dryRun: output.dryRun, plans: output.plans.length, retirements: output.plans.filter((item) => item.action === "RETIRE").length, additions: output.plans.filter((item) => item.action !== "RETIRE").length, output: values.output }, null, 2));
await prisma.$disconnect();
