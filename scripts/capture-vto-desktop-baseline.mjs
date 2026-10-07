// Run explicitly against the approved git object; tests never regenerate goldens.
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { desktopFingerprint } from "../tests/fixtures/rebuild-face.js";

const commit = "7290abcfdd898b06a77416a5499e958370fb088c", root = process.cwd();
const source = execFileSync("git", ["show", `${commit}:src/utils/virtual-try-on-3d-geometry.js`], { encoding: "utf8" });
const folder = path.join(root, "tmp/vto-mobile-rebuild");
await mkdir(folder, { recursive: true });
const temporary = path.join(folder, "approved-geometry.mjs");
await writeFile(temporary, source.replaceAll('"../virtual-try-on-3d/', `"${pathToFileURL(path.join(root, "src/virtual-try-on-3d/")).href}`));
const { landmarksToGlassesPose } = await import(pathToFileURL(temporary));
const report = { commit, poseFilterSha256: createHash("sha256").update(execFileSync("git", ["show", `${commit}:src/virtual-try-on-3d/pose-filter.js`])).digest("hex"), models: {} };
for (const name of ["RB2140-901-50-v2.19", "Harley-Davidson_HD0896_001_V4_definitivo"]) {
  const metadata = JSON.parse(await readFile(path.join(root, `public/virtual-try-on/models/${name}.tryon.json`), "utf8"));
  report.models[name] = desktopFingerprint(landmarksToGlassesPose, metadata);
}
await writeFile(path.join(root, "tests/fixtures/vto-approved-desktop.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(report);
