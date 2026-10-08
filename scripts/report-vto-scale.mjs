import { readFileSync, writeFileSync } from "node:fs";
import { landmarksToGlassesPose } from "../src/utils/virtual-try-on-3d-geometry.js";
import { irisScaleFromDiameters } from "../src/virtual-try-on-3d/physical-scale.js";
import { scaleFace } from "../tests/fixtures/scale-face.js";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const evidence = json("../docs/3d/vto-scale-comparator-before.json");
const models = ["RB2140-901-50-v2.19", "Harley-Davidson_HD0896_001_V4_definitivo"]
  .map((name) => json(`../public/virtual-try-on/models/${name}.tryon.json`));
const captured = evidence.samples.map((sample) => {
  const iris = irisScaleFromDiameters(sample.irisDiametersPx, evidence.videoWidth, evidence.videoHeight,
    [sample.eyeOpeningPxRight, sample.eyeOpeningPxLeft]);
  const corrected = iris.irisScalePxPerMm; // These static samples have high geometric confidence.
  return { ...sample, ...iris, correctedScalePxPerMm: corrected,
    ratioCorrectedToOld: corrected / sample.v1BlendedScalePxPerMm,
    estimatedFaceWidthMm: sample.correctedFaceWidthPx / corrected,
    widthEstimates: models.map((model) => ({ sku: model.identity.sku, frameWidthMm: model.dimensionsMm.frameWidth,
      v1FrameWidthPx: model.dimensionsMm.frameWidth * sample.v1BlendedScalePxPerMm,
      v2FrameWidthPx: model.dimensionsMm.frameWidth * sample.v2ScalePxPerMm,
      correctedFrameWidthPx: model.dimensionsMm.frameWidth * corrected })) };
});
const scenarios = [
  ["wide-face", { faceWidthMm: 180 }], ["narrow-face", { faceWidthMm: 115 }],
  ["reference-155mm", {}], ["camera-near", { pixelsPerMm: 3 }], ["camera-far", { pixelsPerMm: 1.2 }],
].map(([name, options]) => {
  const { landmarks, transform } = scaleFace(options);
  return { name, synthetic: true, inputs: options, models: models.map((model) =>
    ({ sku: model.identity.sku, ...landmarksToGlassesPose(landmarks, 1000, 500, model, transform).scaleDiagnostics })) };
});
const output = { baseline: evidence.v2Commit, historical: evidence.historicalCommit,
  acceptance: "Pending human PC comparison; no branch approved; no merge. Screenshot-derived measurements are not original webcam results.",
  pixels: "Source-video pixels at bridge plane before model rotation, perspective and CSS cover. Manual scale factor 1.",
  formula: "High/stable iris: median inlier diameter / 11.7. Medium/startup: face 55% + iris 45%. Invalid: short hold then smooth fallback; PoseFilter unchanged.",
  captured, scenarios };
writeFileSync(new URL("../docs/3d/vto-scale-fix-evidence.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
for (const sample of captured) {
  console.log(`\nScreenshot ${sample.screenshot}; V2/V1=${sample.ratioV2ToOld.toFixed(6)}; corrected/V1=${sample.ratioCorrectedToOld.toFixed(6)}; estimatedFaceWidthMm=${sample.estimatedFaceWidthMm.toFixed(3)}`);
  console.table([{ metric: "face scale px/mm", V1: sample.v1FaceScalePxPerMm, V2: sample.v2ScalePxPerMm, corrected: sample.v2ScalePxPerMm },
    { metric: "iris scale px/mm", V1: sample.v1IrisScalePxPerMm, V2: null, corrected: sample.irisScalePxPerMm },
    { metric: "final scale px/mm", V1: sample.v1BlendedScalePxPerMm, V2: sample.v2ScalePxPerMm, corrected: sample.correctedScalePxPerMm },
    ...sample.widthEstimates.map((m) => ({ metric: `${m.sku} width px`, V1: m.v1FrameWidthPx, V2: m.v2FrameWidthPx, corrected: m.correctedFrameWidthPx }))]);
}
