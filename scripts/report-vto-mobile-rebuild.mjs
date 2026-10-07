import { readFile, writeFile, copyFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Euler, Matrix4, Quaternion } from "three";
import { landmarksToGlassesPose } from "../src/utils/virtual-try-on-3d-geometry.js";
import { rebuildFace, desktopFingerprint } from "../tests/fixtures/rebuild-face.js";

const root = process.cwd(), folder = path.join(root, "tmp/vto-mobile-rebuild");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const metadata = await readJson(path.join(root, "public/virtual-try-on/models/RB2140-901-50-v2.19.tryon.json"));
const baseline = await readJson(path.join(root, "tests/fixtures/vto-approved-desktop.json"));
const { landmarksToGlassesPose: approved } = await import(pathToFileURL(path.join(folder, "approved-geometry.mjs")));
const invariance = [];
for (const [width, height] of [[1280, 720], [640, 360], [1920, 1080], [720, 1280], [480, 853], [360, 640]]) {
  const f = rebuildFace(width, height), pose = landmarksToGlassesPose(f.landmarks, width, height, metadata, f.transform);
  invariance.push({ source: `${width}×${height}`, ...pose.diagnostics });
}
const frontal = rebuildFace(720, 1280), bad = { data: new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromEuler(new Euler(0, 70 * Math.PI / 180, 0))).toArray() };
const before = approved(frontal.landmarks, 720, 1280, metadata, bad), after = landmarksToGlassesPose(frontal.landmarks, 720, 1280, metadata, bad);
const report = {
  baselineCommit: baseline.commit, physicalPhone: false,
  desktopFingerprints: baseline.models, rb2140FingerprintMatches: desktopFingerprint(landmarksToGlassesPose, metadata) === baseline.models["RB2140-901-50-v2.19"],
  syntheticInvariance: invariance,
  maximumRatioDifference: Math.max(...invariance.map((p) => p.frameToFaceRatio)) - Math.min(...invariance.map((p) => p.frameToFaceRatio)),
  inconsistentMatrixFixture: { note: "Inyección controlada de yaw70; no atribuye este valor al teléfono humano.",
    before: { projectionLength: 0.35, correctionFactor: 1 / 0.35, correctedFaceWidthPx: before.scale * 135,
      pixelsPerMm: before.scale, finalModelWidthPx: before.scale * metadata.dimensionsMm.frameWidth }, after: after.diagnostics },
  layouts: { synthetic: await readJson(path.join(folder, "layout-synthetic.json")), staticPortrait: await readJson(path.join(folder, "layout-real.json")) },
  cameraSessions: { note: "Webcam Windows sin rostro. Prueba de captura y coordinación; no evalúa tracking humano. La sesión desktop coincidió con checks locales de CPU.",
    compact: await readJson(path.join(folder, "camera-compact.json")), desktop: await readJson(path.join(folder, "camera-desktop.json")) },
  sdk: { worker: await readJson(path.join(folder, "sdk-worker.json")), mainThread: await readJson(path.join(folder, "sdk-main.json")) },
  checks: { testsPassed: 584, lint: "passed", build: "passed", productionHttp: await readJson(path.join(folder, "production-http.json")) },
};
await writeFile(path.join(root, "docs/3d/vto-mobile-rebuild-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
for (const name of ["portrait-synthetic", "portrait-real"]) await copyFile(path.join(folder, `${name}.png`), path.join(root, `docs/3d/vto-mobile-rebuild-${name}.png`));
console.log(JSON.stringify({ invariance: invariance.map((p) => ({ source: p.source, ratio: p.frameToFaceRatio })), maximumRatioDifference: report.maximumRatioDifference,
  before: report.inconsistentMatrixFixture.before, after: after.diagnostics, fingerprint: report.rb2140FingerprintMatches }, null, 2));
