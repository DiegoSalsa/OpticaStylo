// Coincidencias por identidad SKU; nunca se fusionan marcas/modelos por similitud.
export const normalizeInventorySku = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export function parseInventoryCsv(text) {
  if (typeof text !== "string" || text.length > 200_000) throw new Error("El CSV debe tener hasta 200.000 caracteres.");
  const delimiter = text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : text.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (char === delimiter || char === "\n" || char === undefined)) {
      row.push(cell.trim()); cell = "";
      if (char !== delimiter) { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (char !== "\r" && char !== undefined) cell += char;
  }
  if (quoted) throw new Error("El CSV contiene comillas sin cerrar.");
  const headers = rows.shift()?.map((value) => value.toLowerCase().replace(/^\uFEFF/, ""));
  const sku = headers?.indexOf("sku"), quantity = headers?.indexOf("cantidad");
  if (sku < 0 || quantity < 0 || sku == null || quantity == null || rows.length < 1 || rows.length > 500) throw new Error("Se requiere CSV con columnas sku,cantidad y entre 1 y 500 filas.");
  return rows.map((values, index) => ({ row: index + 2, sku: values[sku], quantity: /^\d+$/.test(values[quantity] ?? "") ? Number(values[quantity]) : null }));
}
