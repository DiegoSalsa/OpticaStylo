import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadProjectEnvironment } from "./load-environment.mjs";
import { validateTryOnModelMetadata } from "../src/virtual-try-on-3d/model-contract.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LICENSES = new Set(["CC0-1.0", "CC-BY-4.0", "OWNED_BY_OPTICA_STYLO"]);

function argumentsByName(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    if (!name?.startsWith("--") || values[index + 1] == null) throw new Error(`Argumento inválido: ${name ?? "vacío"}.`);
    result[name.slice(2)] = values[index + 1];
  }
  return result;
}

const options = argumentsByName(process.argv.slice(2));
for (const required of ["product-id", "actor-user-id", "model", "metadata", "license"]) {
  if (!options[required]) throw new Error(`Falta --${required}.`);
}
if (!UUID.test(options["product-id"]) || !UUID.test(options["actor-user-id"])) throw new Error("Los identificadores de producto y usuario deben ser UUID válidos.");
if (!LICENSES.has(options.license)) throw new Error("La licencia no está permitida para el catálogo 3D.");
if (options.license === "CC-BY-4.0" && !options.attribution?.trim()) throw new Error("CC-BY-4.0 exige --attribution.");

const modelPath = path.resolve(process.cwd(), options.model);
const metadataPath = path.resolve(process.cwd(), options.metadata);
const modelData = await readFile(modelPath);
if (modelData.length < 12 || modelData.length > 50 * 1024 * 1024 || modelData.subarray(0, 4).toString("ascii") !== "glTF") {
  throw new Error("El archivo debe ser un GLB válido de hasta 50 MiB.");
}
const metadata = validateTryOnModelMetadata(JSON.parse(await readFile(metadataPath, "utf8")));
if (metadata.analysis.status !== "valid") throw new Error("La calibración todavía requiere revisión y no puede publicarse.");

loadProjectEnvironment();
const { prisma, disconnectPrisma } = await import("../src/db/prisma.js");
try {
  const asset = await prisma.$transaction(async (client) => {
    const product = await client.products.findFirst({
      select: { id: true }, where: { category: "FRAME", id: options["product-id"], is_active: true },
    });
    if (!product) throw new Error("El producto no existe o no es un marco activo.");
    await client.virtual_try_on_3d_assets.updateMany({
      data: { retired_at: new Date(), retired_by: options["actor-user-id"], status: "RETIRED" },
      where: { product_id: product.id, status: "ACTIVE" },
    });
    const maximum = await client.virtual_try_on_3d_assets.aggregate({
      _max: { version: true }, where: { product_id: product.id },
    });
    return client.virtual_try_on_3d_assets.create({ data: {
      attribution_text: options.attribution?.trim() || null,
      created_by: options["actor-user-id"], file_sha256: createHash("sha256").update(modelData).digest("hex"),
      file_size_bytes: modelData.length, license_code: options.license,
      model_data: modelData, model_metadata: metadata, original_filename: path.basename(modelPath),
      product_id: product.id, source_url: options.source?.trim() || null,
      version: (maximum._max.version ?? 0) + 1,
    } });
  }, { isolationLevel: "Serializable" });
  process.stdout.write(`Modelo 3D publicado: ${asset.id}, versión ${asset.version}.\n`);
} finally {
  await disconnectPrisma();
}
