import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { analyzeTryOnGlb } from "../src/virtual-try-on-3d/model-importer.js";

const projectRoot = process.cwd();
const requestedConfigs = process.argv.slice(2);
const configPaths = requestedConfigs.length > 0
  ? requestedConfigs
  : ["config/virtual-try-on-3d/HD0896-001.json"];

for (const configPath of configPaths) {
  const absoluteConfigPath = path.resolve(projectRoot, configPath);
  const config = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  const sourcePath = path.resolve(projectRoot, config.source);
  const outputPath = path.resolve(projectRoot, config.output);
  const data = await readFile(sourcePath);
  const metadata = await analyzeTryOnGlb({
    data,
    dimensionsMm: config.dimensionsMm,
    identity: {
      ...config.identity,
      sourceFilename: path.basename(sourcePath),
    },
  });

  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const outcome = metadata.analysis.status === "valid"
    ? "válido"
    : "requiere revisión";
  process.stdout.write(`${config.identity.sku}: ${outcome} → ${config.output}\n`);
  for (const warning of metadata.analysis.warnings) {
    process.stdout.write(`  - ${warning}\n`);
  }
}
