import { mkdir, open, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadProjectEnvironment } from "./load-environment.mjs";
import { importProductImages } from "../src/services/product-image-import-service.js";
import { findProductById } from "../src/repositories/product-repository.js";
import { prisma } from "../src/db/prisma.js";
import { productImageActor } from "./product-image-actor.mjs";

loadProjectEnvironment();
const { values } = parseArgs({ options: {
  inventory: { type: "string" }, manifest: { type: "string" }, actor: { type: "string" },
  apply: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false },
  "allow-production": { type: "boolean", default: false }, "expected-cloud": { type: "string" },
  "expected-database-host": { type: "string" }, "batch-size": { type: "string", default: "25" },
  offset: { type: "string", default: "0" }, concurrency: { type: "string", default: "2" },
  output: { type: "string", default: "tmp/romano-images/import" },
} });
if (!values.inventory || !values.manifest || !values.actor) throw new Error("Indicar --inventory, --manifest y --actor con el UUID de un usuario activo autorizado.");
if (values.apply && values["dry-run"]) throw new Error("Elegir simulación o aplicación.");
const dryRun = !values.apply;
const host = new URL(process.env.DATABASE_URL).hostname;
const local = host === "127.0.0.1" || host === "localhost";
if (!dryRun && (values["expected-cloud"] !== process.env.CLOUDINARY_CLOUD_NAME || values["expected-database-host"] !== host || (!local && !values["allow-production"]))) {
  throw new Error("La carga requiere confirmar la nube, el host de datos y --allow-production si corresponde.");
}
await mkdir(path.dirname(values.output), { recursive: true });
// El bloqueo no se elimina automáticamente tras una caída: revisar el diario antes de desbloquear.
const lockPath = `${values.output}.lock`;
const lock = await open(lockPath, "wx");
try {
  await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString(), dryRun }));
  const actor = await productImageActor(values.actor);
  const inventory = JSON.parse(await readFile(values.inventory, "utf8"));
  const manifest = JSON.parse(await readFile(values.manifest, "utf8"));
  // Apertura con append y sync: cada operación iniciada queda registrada antes de contactar Cloudinary.
  const journal = await open(`${values.output}.jsonl`, "a");
  let journalQueue = Promise.resolve();
  try {
    const result = await importProductImages({
      inventory, manifest, actor, dryRun, batchSize: Number(values["batch-size"]), offset: Number(values.offset), concurrency: Number(values.concurrency),
    }, {
      findProduct: findProductById,
      appendEvent: (event) => {
        journalQueue = journalQueue.then(async () => { await journal.write(`${JSON.stringify(event)}\n`); await journal.sync(); });
        return journalQueue;
      },
    });
    const reportPath = `${values.output}.json`;
    await writeFile(`${reportPath}.tmp`, `${JSON.stringify({ destination: { host, cloud: process.env.CLOUDINARY_CLOUD_NAME, folder: "opticastylo/productos" }, ...result }, null, 2)}\n`);
    await rename(`${reportPath}.tmp`, reportPath);
    console.log(JSON.stringify({ report: reportPath, dryRun, total: result.results.length, nextOffset: result.nextOffset }));
    if (result.results.some((item) => item.status === "TECHNICAL_ERROR")) process.exitCode = 1;
  } finally { await journal.close(); }
} finally { await lock.close(); await unlink(lockPath); await prisma.$disconnect(); }
