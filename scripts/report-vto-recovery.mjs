import { writeFileSync } from "node:fs";
import { PoseFilter } from "../src/virtual-try-on-3d/pose-filter.js";
import { TrackingSession } from "../src/virtual-try-on-3d/tracking-session.js";
import { PhysicalScaleEstimator, irisScaleFromDiameters } from "../src/virtual-try-on-3d/physical-scale.js";
import { SessionScaleEstimator } from "../src/virtual-try-on-3d/session-scale.js";

// Estímulos idénticos para ambos caminos; sólo métricas sintéticas agregadas.
const measurement = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: 2,
  faceMesh: { positions: new Float32Array(1404) } };
const tracking = [20, 90, 140, 220].map((latencyMs) => {
  const before = new PoseFilter(), after = new TrackingSession();
  const interval = Math.ceil(Math.max(1000 / 30, latencyMs * 1.15) / (1000 / 30)) * 1000 / 30;
  let beforeVisible = 0, afterVisible = 0, frames = 0, firstBefore = null, firstAfter = null, next = 0;
  for (let now = 0; now <= 3000; now += 1000 / 60) {
    if (now >= next + latencyMs) {
      before.update(measurement, next); after.update(measurement, next, now); next += interval;
    }
    if (before.sample(now)) { beforeVisible++; firstBefore ??= now; }
    if (after.sample(now)) { afterVisible++; firstAfter ??= now; }
    frames++;
  }
  return { latencyMs, sampleIntervalMs: interval, firstPoseBeforeMs: firstBefore, firstPoseAfterMs: firstAfter,
    visibleFractionBefore: beforeVisible / frames, visibleFractionAfter: afterVisible / frames };
});
const before = new PhysicalScaleEstimator(), after = new SessionScaleEstimator();
const iris = irisScaleFromDiameters([23.4, 23.4, 23.4, 23.4], 1000, 500, [18, 18]);
let beforeScale, afterScale;
for (let now = 0; now <= 990; now += 33) {
  if (now % 99 === 66) { before.reset(); continue; }
  beforeScale = before.update(2.8, iris, 1000, now).pixelsPerMm;
  afterScale = after.update(2.8, iris, 1000, now).pixelsPerMm;
}
const report = { stimulus: "synthetic-identical-inputs-not-physical-phone", baseline: "db686b4",
  tracking, scale: { facePriorPxPerMm: 2.8, irisReferencePxPerMm: 2,
    missingPoseEveryNthInference: 3, beforePxPerMm: beforeScale, afterPxPerMm: afterScale,
    beforeRelativeWidthError: beforeScale / 2 - 1, afterRelativeWidthError: afterScale / 2 - 1 },
  limits: { extrapolationMs: 25, captureAgeCeilingMs: 360, deliverySilenceCeilingMs: 180 } };
writeFileSync(new URL("../docs/3d/vto-recovery-evidence.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
