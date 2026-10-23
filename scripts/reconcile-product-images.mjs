import { readFile, open, unlink } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadProjectEnvironment } from "./load-environment.mjs";
import { getCloudinaryMediaGateway } from "../src/integrations/media/cloudinary-media-gateway.js";
import { prisma } from "../src/db/prisma.js";
import { productImageActor } from "./product-image-actor.mjs";

loadProjectEnvironment();
const { values } = parseArgs({ options: {
  journal: { type: "string" }, actor: { type: "string" }, "apply-cleanup": { type: "boolean", default: false },
  "expected-cloud": { type: "string" }, "expected-database-host": { type: "string" },
} });
if (!values.journal?.endsWith(".jsonl") || !values.actor) throw new Error("Indicar --journal y --actor.");
const host = new URL(process.env.DATABASE_URL).hostname;
if (values["apply-cleanup"] && (values["expected-cloud"] !== process.env.CLOUDINARY_CLOUD_NAME || values["expected-database-host"] !== host)) throw new Error("Confirmar nube y host antes de limpiar recursos huérfanos.");
const lockPath = values.journal.replace(/\.jsonl$/, ".lock");
const lock = await open(lockPath, "wx");
try {
  await productImageActor(values.actor);
  const latest = new Map();
  const lines = (await readFile(values.journal, "utf8")).trim().split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]) continue;
    let event;
    try { event = JSON.parse(lines[index]); } catch {
      // Una caída puede cortar solo la última línea; el inicio de la operación ya fue sincronizado.
      if (index === lines.length - 1) break;
      throw new Error("El diario tiene una línea intermedia inválida.");
    }
    if (/^opticastylo\/productos\/romano-[a-f0-9]{64}$/.test(event.publicId)) latest.set(event.publicId, event);
  }
  const gateway = values["apply-cleanup"] ? getCloudinaryMediaGateway() : null;
  for (const [publicId, event] of latest) {
    const linked = await prisma.product_images.count({ where: { cloudinary_public_id: publicId } });
    const oldEnough = Date.now() - Date.parse(event.at) >= 24 * 60 * 60 * 1000;
    let status = linked ? "LINKED_PROTECTED" : oldEnough ? "UNLINKED_REVIEW" : "RECENT_PROTECTED";
    if (gateway && !linked && oldEnough) status = await gateway.deletePublicProductImage({ publicId }) ? "ORPHAN_REMOVED" : "CLEANUP_FAILED";
    console.log(JSON.stringify({ publicId, status }));
  }
} finally { await lock.close(); await unlink(lockPath); await prisma.$disconnect(); }
