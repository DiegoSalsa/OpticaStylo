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
if (!UUID.test(options["product-id"]) || !UUID.test(options["actor-user-id"])) {
  throw new Error("Los identificadores de producto y usuario deben ser UUID válidos.");
}
if (!LICENSES.has(options.license)) throw new Error("La licencia no está permitida para el catálogo 3D.");
if (options.license === "CC-BY-4.0" && !options.attribution?.trim()) {
  throw new Error("CC-BY-4.0 exige --attribution.");
}

const modelPath = path.resolve(process.cwd(), options.model);
const metadataPath = path.resolve(process.cwd(), options.metadata);
const modelData = await readFile(modelPath);
if (modelData.length < 12 || modelData.length > 50 * 1024 * 1024 || modelData.subarray(0, 4).toString("ascii") !== "glTF") {
  throw new Error("El archivo debe ser un GLB válido de hasta 50 MiB.");
}
const metadata = validateTryOnModelMetadata(JSON.parse(await readFile(metadataPath, "utf8")));
if (metadata.analysis.status !== "valid") throw new Error("La calibración todavía requiere revisión y no puede publicarse.");

loadProjectEnvironment();
const { executeTransaction } = await import("../src/db/query.js");
const { closeDatabasePool } = await import("../src/db/pool.js");
try {
  const asset = await executeTransaction(async (client) => {
    const product = await client.query(
      "SELECT id FROM products WHERE id = $1 AND category = 'FRAME' AND is_active = TRUE FOR UPDATE",
      [options["product-id"]],
    );
    if (product.rowCount === 0) throw new Error("El producto no existe o no es un marco activo.");
    await client.query(
      `UPDATE virtual_try_on_3d_assets SET status = 'RETIRED', retired_by = $2,
         retired_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND status = 'ACTIVE'`,
      [options["product-id"], options["actor-user-id"]],
    );
    const inserted = await client.query(
      `INSERT INTO virtual_try_on_3d_assets (
         product_id, version, original_filename, file_size_bytes, file_sha256,
         model_data, model_metadata, license_code, attribution_text, source_url, created_by
       ) SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6::JSONB,
                $7, $8, $9, $10
         FROM virtual_try_on_3d_assets WHERE product_id = $1 RETURNING id, version`,
      [options["product-id"], path.basename(modelPath), modelData.length,
        createHash("sha256").update(modelData).digest("hex"), modelData,
        JSON.stringify(metadata), options.license, options.attribution?.trim() || null,
        options.source?.trim() || null, options["actor-user-id"]],
    );
    return inserted.rows[0];
  });
  process.stdout.write(`Modelo 3D publicado: ${asset.id}, versión ${asset.version}.\n`);
} finally {
  await closeDatabasePool();
}
