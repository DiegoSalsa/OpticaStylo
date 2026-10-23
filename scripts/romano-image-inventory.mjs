import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { readSheet } from "read-excel-file/node";
import { normalizeRomanoRows } from "../src/integrations/inventory/romano-image-inventory.js";

const { values } = parseArgs({ options: { excel: { type: "string" }, output: { type: "string", default: "tmp/romano-images/inventory.json" } } });
if (!values.excel) throw new Error("Indicar --excel con el archivo maestro actualizado.");
const bytes = await readFile(values.excel);
const workbookSha256 = createHash("sha256").update(bytes).digest("hex");
const rows = await readSheet(bytes, "Inventario Romano");
const result = {
  source: path.basename(values.excel), workbookSha256,
  ...normalizeRomanoRows(rows, { workbookSha256 }),
};
await mkdir(path.dirname(values.output), { recursive: true });
await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result.summary, workbookSha256, output: values.output }));
