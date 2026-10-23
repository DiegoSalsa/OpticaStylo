import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  inventory: { type: "string" }, candidates: { type: "string" }, research: { type: "string" },
  journal: { type: "string" }, output: { type: "string", default: "tmp/romano-images/coverage.json" },
} });
if (!values.inventory || !values.candidates || !values.research) throw new Error("Indicar --inventory, --candidates y --research.");
const inventory = JSON.parse(await readFile(values.inventory, "utf8"));
const manifest = JSON.parse(await readFile(values.candidates, "utf8"));
if (inventory.workbookSha256 !== manifest.workbookSha256) throw new Error("Las candidatas no corresponden al archivo maestro.");
const searches = (await Promise.all((await readdir(values.research)).filter((name) => /^search-.*\.json$/.test(name)).map(async (name) => JSON.parse(await readFile(path.join(values.research, name), "utf8"))))).flat();
const byModel = new Map(searches.map((item) => [item.key, item]));
const latest = new Map();
if (values.journal) {
  for (const line of (await readFile(values.journal, "utf8")).trim().split("\n").filter(Boolean)) {
    const event = JSON.parse(line); latest.set(event.candidateId, event);
  }
}
const records = inventory.variants.map((variant) => {
  const search = byModel.get(`${variant.brand}|${variant.model}`);
  const candidates = manifest.candidates.filter((item) => item.inventoryKey === variant.key);
  const associated = candidates.map((item) => latest.get(item.id)).filter((item) => ["ASSOCIATED", "ALREADY_ASSOCIATED"].includes(item?.status));
  let status = associated.length ? "ASSOCIATED" : candidates.length ? "FOUND_PENDING_AUTHORIZATION" : !variant.color ? "UNCERTAIN_MATCH" : search?.leads.length ? "UNCERTAIN_MATCH" : search ? "NOT_FOUND_IN_SEARCH" : "NOT_RESEARCHED";
  if (candidates.some((item) => item.authorization?.status === "AUTHORIZED") && !associated.length) status = "AUTHORIZED_PENDING_IMPORT";
  return {
    key: variant.key, brand: variant.brand, model: variant.model, color: variant.color,
    rows: variant.rows.map(({ sheet, row, originalRow, block }) => ({ sheet, row, originalRow, block })),
    status, reason: associated.length ? "Asociación persistida" : candidates.length ? "Falta comprobar autorización comercial y correspondencia con un producto; no publicar" : !variant.color ? "El archivo maestro no identifica el color" : search?.leads.length ? "Resultados de búsqueda sin fotografía exacta y autorizada verificada" : "No se verificó una fotografía exacta en la búsqueda realizada; no demuestra inexistencia",
    candidateIds: candidates.map((item) => item.id),
    sourceLinks: [...new Set(candidates.map((item) => item.sourceUrl))],
    searchQuery: search?.query ?? null, searchedAt: search?.searchedAt ?? null,
  };
});
const associated = [...latest.values()].filter((event) => ["ASSOCIATED", "ALREADY_ASSOCIATED"].includes(event.status));
const counts = records.reduce((summary, record) => ({ ...summary, [record.status]: (summary[record.status] ?? 0) + 1 }), {});
const result = {
  workbook: inventory.source, workbookSha256: inventory.workbookSha256, generatedAt: new Date().toISOString(),
  summary: {
    ...inventory.summary, searchedModels: byModel.size, searchedReferences: records.filter((row) => row.searchedAt).length,
    modelsWithUnverifiedSearchLeads: searches.filter((item) => item.leads.length).length,
    candidatePhotos: manifest.candidates.length,
    manufacturerVerifiedOfficialPhotos: manifest.candidates.filter((item) => item.officialStatus === "MANUFACTURER_VERIFIED").length,
    authorizedPhotos: manifest.candidates.filter((item) => item.authorization?.status === "AUTHORIZED").length,
    uploadedAndPersistedAssets: new Set(associated.map((item) => item.assetId)).size,
    associatedImages: new Set(associated.map((item) => item.imageId)).size, statusCounts: counts,
  }, excluded: inventory.excluded, records,
};
await mkdir(path.dirname(values.output), { recursive: true });
await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary));
