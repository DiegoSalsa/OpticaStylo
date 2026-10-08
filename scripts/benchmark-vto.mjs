import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { landmarksToGlassesPose } from "../src/utils/virtual-try-on-3d-geometry.js";
import { PoseFilter } from "../src/virtual-try-on-3d/pose-filter.js";
import { analyzeTryOnGlb } from "../src/virtual-try-on-3d/model-importer.js";
import { faceLandmarks } from "../tests/fixtures/vto-fixtures.js";

const percentile = (values, fraction) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
const round = (n) => Number(n.toFixed(4));
const report = { environment: { node: process.version, platform: process.platform, arch: process.arch },
  note: "CPU benchmark con fixtures; no mide MediaPipe, cámara ni rendimiento móvil.", models: {} };
for (const file of ["Harley-Davidson_HD0896_001_V4_definitivo", "RB2140-901-50-v2.19"]) {
  const metadata = JSON.parse(await readFile(new URL(`../public/virtual-try-on/models/${file}.tryon.json`, import.meta.url)));
  const filter = new PoseFilter(), durations = [], samples = [];
  const frames = Array.from({ length: 1000 }, (_, i) => faceLandmarks({ yaw: Math.sin(i / 45) * Math.PI / 4, x: Math.sin(i / 15) * 60, zoom: 1 + Math.sin(i / 100) * 0.2 }));
  for (let i = 0; i < frames.length; i++) {
    const start = performance.now(), f = frames[i];
    const pose = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform);
    filter.update(pose, i * 33.333); filter.sample(i * 33.333 + 16.667);
    if (i > 100) durations.push(performance.now() - start);
  }
  const quiet = new PoseFilter();
  for (let i = 0; i < 300; i++) {
    const f = frames[0], pose = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform);
    pose.position[0] += i % 2 ? 0.3 : -0.3;
    quiet.update(pose, i * 16.667); if (i > 60) samples.push(quiet.sample(i * 16.667 + 16).position[0]);
  }
  const data = await readFile(new URL(`../public/virtual-try-on/models/${file}.glb`, import.meta.url));
  const start = performance.now();
  await analyzeTryOnGlb({ data, identity: metadata.identity, dimensionsMm: metadata.dimensionsMm });
  report.models[file] = { poseFitFilterP50Ms: round(percentile(durations, 0.5)), poseFitFilterP95Ms: round(percentile(durations, 0.95)),
    importMs: round(performance.now() - start), syntheticQuietRmsPx: round(Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length)) };
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
