import { createHash } from "node:crypto";

export const normalizeCode = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/[\s-]+/g, "");
const aliases = {
  "A.FALCONI": "ANGELO FALCONI", "A. FALCONI": "ANGELO FALCONI",
  GATTI: "GATTIZONI", GATTTIZONI: "GATTIZONI", "CUP ON": "CLIP ON",
  RODESTOCK: "RODENSTOCK", PIUS: "PRIUS",
};
export function normalizeBrand(value) {
  const name = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
  return aliases[name] ?? name;
}
export function inventoryKey({ brand, model, color }) {
  return [normalizeBrand(brand), normalizeCode(model), normalizeCode(color)].join("|");
}

// Conservar los códigos de color literales: O700 no se convierte en 0700 sin evidencia.
export function normalizeRomanoRows(rows, { workbookSha256, sheet = "Inventario Romano" } = {}) {
  const header = rows.findIndex((row) => row[0] === "Fila Excel" && row[3] === "Código / modelo");
  if (header < 0) throw new Error("El libro no contiene las columnas del inventario Romano actualizado.");
  const variants = new Map();
  const excluded = [];
  rows.slice(header + 1).forEach((row, offset) => {
    if (!row.some((cell) => cell != null && cell !== "")) return;
    const trace = {
      sheet, row: header + offset + 2, originalRow: row[0], block: row[1],
      originalBrand: row[2] ?? "", originalModel: String(row[3] ?? ""), originalColor: String(row[4] ?? ""),
      priceStatus: row[11] ?? null,
      confirmedPriceClp: typeof row[9] === "number" && row[9] > 0 ? row[9] : null,
    };
    if (!row[2] || !row[3] || /LOTE|SEGURIDAD/.test(String(row[11])) || /UNIDADES|L\.?\s*SEGURIDAD/.test(String(row[2]))) {
      excluded.push({ ...trace, reason: !row[3] ? "MISSING_MODEL" : "LOT_OR_UNIDENTIFIABLE" });
      return;
    }
    const identity = { brand: normalizeBrand(row[2]), model: normalizeCode(row[3]), color: normalizeCode(row[4]) };
    const key = inventoryKey(identity);
    if (!variants.has(key)) variants.set(key, {
      key, id: createHash("sha256").update(key).digest("hex").slice(0, 20),
      ...identity, branch: "GALERIA_ROMANO", workbookSha256, rows: [],
      researchStatus: identity.color ? "NOT_RESEARCHED" : "UNCERTAIN_MATCH",
      reason: identity.color ? "Pendiente de investigación y autorización" : "El Excel no identifica el color",
    });
    variants.get(key).rows.push(trace);
  });
  const items = [...variants.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    variants: items, excluded,
    summary: {
      sourceRows: items.reduce((count, item) => count + item.rows.length, 0), excludedRows: excluded.length,
      brands: new Set(items.map((item) => item.brand)).size,
      models: new Set(items.map((item) => `${item.brand}|${item.model}`)).size,
      variants: items.length, missingColor: items.filter((item) => !item.color).length,
      stockAudited: false,
    },
  };
}
