import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUILT_IN_3D_GLASSES } from "../constants/virtual-try-on.js";
import { validateTryOnModelMetadata } from "../virtual-try-on-3d/model-contract.js";

// El mismo manifiesto que utiliza el probador publica los modelos incluidos con la app.
// Un SKU por sí solo no basta: ambos archivos deben existir y coincidir con el contrato.
export async function availableBundledTryOnModels({ models = BUILT_IN_3D_GLASSES, read = readFile } = {}) {
  const results = await Promise.all(models.map(async (model) => {
    try {
      const [bytes, json] = await Promise.all([model.modelUrl, model.metadataUrl].map((url) => read(path.join(process.cwd(), "public", url), url.endsWith(".json") ? "utf8" : undefined)));
      const metadata = validateTryOnModelMetadata(JSON.parse(json));
      if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "glTF"
        || metadata.identity.sku !== model.sku
        || createHash("sha256").update(bytes).digest("hex") !== metadata.identity.sha256) return null;
      return model;
    } catch { return null; }
  }));
  return results.filter(Boolean);
}
