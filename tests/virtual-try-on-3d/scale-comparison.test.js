import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { landmarksToGlassesPose as oldPose } from "../fixtures/historical-v1-geometry.js";
import { landmarksToGlassesPose as currentV2Pose } from "../fixtures/historical-v2-geometry.js";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { compareScales } from "../../src/virtual-try-on-3d/scale-comparison.js";
import { scaleFace } from "../fixtures/scale-face.js";

const metadata = JSON.parse(readFileSync(new URL("../fixtures/hd0896-v1.json", import.meta.url)));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

for (const frameWidthMm of [137, 147.85990119]) {
  for (const options of [{}, { faceWidthMm: 135 }, { faceWidthMm: 120 }, { pixelsPerMm: 3 },
    { yaw: 0.7 }, { yaw: 1.2, roll: 0.1 }, { pitch: 0.4 }]) {
    for (const resolution of [[1000, 500], [2000, 1000], [800, 600]]) {
      test(`comparador contra V1 y V2 reales, ${frameWidthMm} mm, ${JSON.stringify(options)}, ${resolution}`, () => {
        const { landmarks, transform } = scaleFace(options);
        const model = { ...metadata, dimensionsMm: { ...metadata.dimensionsMm, frameWidth: frameWidthMm } };
        const before = oldPose(landmarks, ...resolution, model, transform);
        const v2 = currentV2Pose(landmarks, ...resolution, model, transform);
        const diagnostics = landmarksToGlassesPose(landmarks, ...resolution, model, transform).scaleDiagnostics;
        assert.ok(before && v2);
        near(diagnostics.v1BlendedScalePxPerMm, before.scale);
        near(diagnostics.v2ScalePxPerMm, v2.scale);
        near(diagnostics.oldEstimatedFrameWidthPx, before.scale * frameWidthMm);
        near(diagnostics.v2EstimatedFrameWidthPx, v2.scale * frameWidthMm);
        near(diagnostics.ratioV2ToOld, v2.scale / before.scale);
      });
    }
  }
}

test("oldScale=2, v2Scale=2.5 registra sobredimensión exacta de 25%", () => {
  const face = scaleFace({ faceWidthMm: 135 });
  // Make both historical projected face and iris exactly 2 px/mm.
  face.landmarks[234] = { x: 0.365, y: 0.5, z: 0 };
  face.landmarks[454] = { x: 0.635, y: 0.5, z: 0 };
  const metrics = compareScales(face.landmarks, 1000, 500, face.transform, {
    unprojectedFaceWidthPx: 270, projectionLength: 0.8, correctedFaceWidthPx: 337.5,
    frameWidthMm: 137,
  });
  near(metrics.v1BlendedScalePxPerMm, 2);
  near(metrics.v2ScalePxPerMm, 2.5);
  near(metrics.ratioV2ToOld, 1.25);
  near(metrics.oldEstimatedFrameWidthPx, 274);
  near(metrics.v2EstimatedFrameWidthPx, 342.5);
});

for (const mode of ["fallback-yaw", "typed-transform", "missing-iris", "one-iris"]) {
  test(`comparador histórico conserva el caso ${mode}`, () => {
    const { landmarks, transform } = scaleFace({ yaw: 0.5 });
    const matrix = mode === "fallback-yaw" ? null : mode === "typed-transform"
      ? { data: new Float32Array(transform.data) } : transform;
    if (mode === "missing-iris") for (let i = 468; i < 478; i++) landmarks[i] = undefined;
    if (mode === "one-iris") landmarks[475] = undefined;
    const before = oldPose(landmarks, 1000, 500, metadata, matrix);
    const p = landmarksToGlassesPose(landmarks, 1000, 500, metadata, matrix);
    near(p.scaleDiagnostics.v1BlendedScalePxPerMm, before.scale);
    near(p.scaleDiagnostics.v2ScalePxPerMm, currentV2Pose(landmarks, 1000, 500, metadata, matrix).scale);
  });
}
