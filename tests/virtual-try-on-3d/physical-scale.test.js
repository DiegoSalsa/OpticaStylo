import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Matrix4, Quaternion, Vector3 } from "three";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { landmarksToGlassesPose as oldPose } from "../fixtures/historical-v1-geometry.js";
import { landmarksToGlassesPose as v2Pose } from "../fixtures/historical-v2-geometry.js";
import { AVERAGE_IRIS_DIAMETER_MM } from "../../src/virtual-try-on-3d/scale-comparison.js";
import { measureIrisScale, irisScaleFromDiameters, PhysicalScaleEstimator, IRIS_HOLD_MS } from "../../src/virtual-try-on-3d/physical-scale.js";
import { PoseFilter } from "../../src/virtual-try-on-3d/pose-filter.js";
import { scaleFace } from "../fixtures/scale-face.js";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const models = ["RB2140-901-50-v2.19", "Harley-Davidson_HD0896_001_V4_definitivo"]
  .map((name) => readJson(`../../public/virtual-try-on/models/${name}.tryon.json`));
const legacyModel = readJson("../fixtures/hd0896-v1.json");
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const fit = (face, model = models[0], adjustment = null, estimator = null, timestamp = null, resolution = [1000, 500]) =>
  landmarksToGlassesPose(face.landmarks, ...resolution, model, face.transform, adjustment, estimator, timestamp);

test("la constante física sigue siendo 11.7 mm", () => assert.equal(AVERAGE_IRIS_DIAMETER_MM, 11.7));

for (const faceWidthMm of [115, 135, 155, 180]) for (const model of models) {
  test(`rostro ${faceWidthMm} mm mantiene iris físico; ${model.identity.sku}`, () => {
    const face = scaleFace({ faceWidthMm, pixelsPerMm: 2 }), p = fit(face, model);
    near(p.scale, 2);
    near(p.scaleDiagnostics.estimatedFaceWidthMm, faceWidthMm);
    near(p.scaleDiagnostics.correctedEstimatedFrameWidthPx, 2 * model.dimensionsMm.frameWidth);
    const legacy = { ...legacyModel, dimensionsMm: model.dimensionsMm };
    const a = oldPose(face.landmarks, 1000, 500, legacy, face.transform);
    const b = v2Pose(face.landmarks, 1000, 500, legacy, face.transform);
    near(p.scaleDiagnostics.ratioV2ToOld, b.scale / a.scale);
    near(p.scaleDiagnostics.ratioCorrectedToOld, p.scale / a.scale);
    // The difference is explained by the measured anatomy, not a model factor.
    assert.ok(p.scale / a.scale < 1.2);
  });
}

for (const pixelsPerMm of [1.1, 2, 3.6]) test(`cámara cerca/lejos: iris observado da ${pixelsPerMm} px/mm`, () => {
  near(fit(scaleFace({ pixelsPerMm })).scale, pixelsPerMm);
});

test("resolución duplicada conserva exactamente escala relativa y proporción entre modelos", () => {
  const face = scaleFace();
  for (const model of models) {
    const first = fit(face, model), second = fit(face, model, null, null, null, [2000, 1000]);
    near(second.scale / first.scale, 2);
    near(second.scaleDiagnostics.ratioCorrectedToOld, first.scaleDiagnostics.ratioCorrectedToOld);
    near(second.scaleDiagnostics.estimatedFaceWidthMm, first.scaleDiagnostics.estimatedFaceWidthMm);
  }
});

for (const mirrored of [true, false]) for (const verticalOffsetMm of [0, 6]) {
  test(`trasladar iris conserva posición/quaternion/escala; espejo=${mirrored}, offset=${verticalOffsetMm}`, () => {
    const face = scaleFace({ yaw: 0.25 }), adjustment = { mirrored, verticalOffsetMm };
    const before = fit(face, models[0], adjustment);
    for (let i = 468; i < 478; i++) {
      face.landmarks[i].x += 0.012; face.landmarks[i].y -= 0.007;
      face.landmarks[i].z = NaN;
    }
    const after = fit(face, models[0], adjustment);
    assert.deepEqual(after.position, before.position);
    assert.deepEqual(after.quaternion, before.quaternion);
    near(after.scale, before.scale, 1e-12);
    near(after.scaleDiagnostics.irisScalePxPerMm, before.scaleDiagnostics.irisScalePxPerMm, 1e-12);
  });
}

test("sólo cambiar diámetro altera escala, preservando apoyo y quaternion V2 incluso con offset", () => {
  const face = scaleFace(), adjustment = { verticalOffsetMm: 4 };
  const before = fit(face, models[0], adjustment);
  for (const [center, end] of [[468, 472], [473, 477]]) for (let i = center + 1; i <= end; i++) {
    const origin = face.landmarks[center], point = face.landmarks[i];
    point.x = origin.x + (point.x - origin.x) * 1.2;
    point.y = origin.y + (point.y - origin.y) * 1.2;
  }
  const after = fit(face, models[0], adjustment);
  near(after.scale / before.scale, 1.2);
  assert.deepEqual(after.position, before.position); assert.deepEqual(after.quaternion, before.quaternion);
  const baseline = v2Pose(face.landmarks, 1000, 500, models[0], face.transform, adjustment);
  assert.deepEqual(after.position, baseline.position); assert.deepEqual(after.quaternion, baseline.quaternion);
});

test("máscara con iris válido sigue reproyectándose sobre la misma superficie facial V2", () => {
  const face = scaleFace({ yaw: 0.5, pitch: 0.2 }), pose = fit(face);
  const matrix = new Matrix4().compose(new Vector3().fromArray(pose.position), new Quaternion().fromArray(pose.quaternion),
    new Vector3().setScalar(pose.scale));
  for (const index of [6, 33, 263, 234, 454, 10, 152]) {
    const point = new Vector3().fromArray(pose.faceMesh.positions, index * 3).applyMatrix4(matrix);
    const perspective = 1000 / (1000 - point.z);
    near(point.x * perspective + 500, (1 - face.landmarks[index].x) * 1000, 0.001);
    near(250 - point.y * perspective, face.landmarks[index].y * 500, 0.001);
  }
});

test("mediana rechaza un diámetro aberrante y usa los tres restantes", () => {
  const measurement = irisScaleFromDiameters([23.4, 23.4, 100, 23.4], 1000, 500, [18, 18]);
  near(measurement.irisScalePxPerMm, 2); assert.equal(measurement.irisInlierCount, 3);
  assert.equal(measurement.irisConfidence, "medium");
});

test("desacuerdo entre ojos se rechaza sin calibrarlo contra el ancho facial", () => {
  const measurement = irisScaleFromDiameters([23.4, 23.4, 30, 30], 1000, 500, [20, 20]);
  assert.equal(measurement.irisScalePxPerMm, null);
  assert.equal(measurement.irisRejectionReason, "left-right-inconsistent");
});

test("párpados cerrados invalidan incluso iris con diámetro plausible", () => {
  const face = scaleFace();
  for (const [a, b] of [[159, 145], [386, 374]]) face.landmarks[a] = { ...face.landmarks[b] };
  const measurement = measureIrisScale(face.landmarks, 1000, 500);
  assert.equal(measurement.irisConfidence, "invalid");
  assert.equal(measurement.irisScalePxPerMm, null);
});

test("histórico 55/45 y V2 original son seleccionables sin tocar los demás canales", () => {
  const face = scaleFace(), legacy = { ...legacyModel, dimensionsMm: models[0].dimensionsMm };
  const historical = fit(face, models[0], { scaleMode: "historical" });
  const current = fit(face, models[0], { scaleMode: "v2" });
  near(historical.scale, oldPose(face.landmarks, 1000, 500, legacy, face.transform).scale);
  near(current.scale, v2Pose(face.landmarks, 1000, 500, models[0], face.transform).scale);
  assert.deepEqual(historical.position, current.position);
  assert.deepEqual(historical.quaternion, current.quaternion);
});

function settledEstimator(face = scaleFace()) {
  const estimator = new PhysicalScaleEstimator();
  let pose;
  for (let timestamp = 0; timestamp <= 660; timestamp += 33) pose = fit(face, models[0], null, estimator, timestamp);
  return { estimator, pose, face, timestamp: 660 };
}

test("iris claro estable domina faceScale=2.8 con irisScale=2.0", () => {
  const { pose } = settledEstimator(scaleFace({ faceWidthMm: 189, pixelsPerMm: 2 }));
  near(pose.scaleDiagnostics.v2ScalePxPerMm, 2.8); near(pose.scale, 2);
  assert.equal(pose.scaleDiagnostics.irisWeight, 1);
});

test("parpadeo no salta; pérdida larga transiciona suave usando el filtro V2 intacto", () => {
  const { estimator, face, pose, timestamp } = settledEstimator();
  const filter = new PoseFilter(); filter.update(pose, timestamp);
  for (let i = 468; i < 478; i++) face.landmarks[i] = undefined;
  for (let age = 33; age <= IRIS_HOLD_MS; age += 33) {
    const missing = fit(face, models[0], null, estimator, timestamp + age);
    near(missing.scale, pose.scale);
    filter.update(missing, timestamp + age); near(filter.sample(timestamp + age).scale, pose.scale);
  }
  const transition = fit(face, models[0], null, estimator, timestamp + IRIS_HOLD_MS + 1);
  assert.ok(transition.scale > pose.scale);
  assert.ok(transition.scale - pose.scale < 0.005);
  let previous = transition.scale;
  for (let age = 528; age <= 2508; age += 33) {
    const next = fit(face, models[0], null, estimator, timestamp + age);
    assert.ok(next.scale >= previous); assert.ok(next.scale - previous < 0.05);
    filter.update(next, timestamp + age); assert.ok(Number.isFinite(filter.sample(timestamp + age).scale));
    previous = next.scale;
  }
  near(previous, pose.scaleDiagnostics.v2ScalePxPerMm, 0.005);
});

test("un ojo temporalmente inválido retiene escala y transiciona sin salto al blend", () => {
  const { estimator, face, pose, timestamp } = settledEstimator();
  for (let i = 474; i <= 477; i++) face.landmarks[i] = undefined;
  near(fit(face, models[0], null, estimator, timestamp + 33).scale, pose.scale);
  const next = fit(face, models[0], null, estimator, timestamp + 501);
  assert.ok(Math.abs(next.scale - pose.scale) < 0.005);
});

test("un outlier temporal se retiene; cambios persistentes pueden recuperar confianza", () => {
  const { estimator, face, pose, timestamp } = settledEstimator();
  const bad = structuredClone(face);
  for (let i = 469; i <= 477; i++) {
    if (i === 473) continue;
    const center = bad.landmarks[i < 473 ? 468 : 473], point = bad.landmarks[i];
    point.x = center.x + (point.x - center.x) * 0.6; point.y = center.y + (point.y - center.y) * 0.6;
  }
  near(fit(bad, models[0], null, estimator, timestamp + 33).scale, pose.scale);
  for (let t = timestamp + 66; t < timestamp + 600; t += 33) fit(bad, models[0], null, estimator, t);
  near(fit(bad, models[0], null, estimator, timestamp + 600).scale, 1.2);
});

test("cerca/lejos en vivo mantiene respuesta: iris/face estable no bloquea distancia", () => {
  const { estimator, timestamp } = settledEstimator();
  const pose = fit(scaleFace({ pixelsPerMm: 3 }), models[0], null, estimator, timestamp + 33);
  near(pose.scale, 3); assert.equal(pose.scaleDiagnostics.scaleSource, "iris");
});

test("variación ordinaria del prior facial no vuelve a dominar un iris claro ya estable", () => {
  const { estimator, timestamp } = settledEstimator();
  const pose = fit(scaleFace({ faceWidthMm: 170 }), models[0], null, estimator, timestamp + 33);
  near(pose.scale, 2); assert.equal(pose.scaleDiagnostics.irisWeight, 1);
});

test("retención sobrevive cambio de resolución, pero reset no arrastra otra cara", () => {
  const { estimator, face, pose, timestamp } = settledEstimator();
  for (let i = 468; i < 478; i++) face.landmarks[i] = undefined;
  near(fit(face, models[0], null, estimator, timestamp + 33, [2000, 1000]).scale, pose.scale * 2);
  estimator.reset();
  const fallback = fit(face, models[0], null, estimator, timestamp + 66);
  near(fallback.scale, fallback.scaleDiagnostics.v2ScalePxPerMm);
});

test("muestras repetidas/antiguas no contaminan el estado de escala", () => {
  const { estimator, pose, timestamp } = settledEstimator();
  const different = scaleFace({ pixelsPerMm: 3 });
  near(fit(different, models[0], null, estimator, timestamp).scale, pose.scale);
  near(fit(different, models[0], null, estimator, timestamp - 50).scale, pose.scale);
});

test("capturas reales medidas antes del cambio: crecimiento V2 explicado y escala propuesta cerca de V1", () => {
  const evidence = readJson("../../docs/3d/vto-scale-comparator-before.json");
  for (const sample of evidence.samples) {
    const measurement = irisScaleFromDiameters(sample.irisDiametersPx, evidence.videoWidth, evidence.videoHeight,
      [sample.eyeOpeningPxRight, sample.eyeOpeningPxLeft]);
    assert.equal(measurement.irisConfidence, "high");
    assert.ok(sample.ratioV2ToOld > 1.16 && sample.ratioV2ToOld < 1.20);
    const ratio = measurement.irisScalePxPerMm / sample.v1BlendedScalePxPerMm;
    assert.ok(ratio > 0.97 && ratio < 1.02);
    const widthMm = sample.correctedFaceWidthPx / measurement.irisScalePxPerMm;
    assert.ok(widthMm > 150 && widthMm < 170);
    for (const model of models) near(measurement.irisScalePxPerMm * model.dimensionsMm.frameWidth
      / (sample.v1BlendedScalePxPerMm * model.dimensionsMm.frameWidth), ratio);
  }
});

// Detect accidental edits to the actual archived algorithms, independent of
// tests for their outputs. Hashes restore only the rewritten import prefixes.
test("snapshots V1/V2 conservan el código original completo", () => {
  for (const [version, expected] of Object.entries(HISTORICAL_HASHES)) {
    const text = readFileSync(new URL(`../fixtures/historical-${version}-geometry.js`, import.meta.url), "utf8")
      .split("\n").slice(1).join("\n").replaceAll('"../../src/constants/', '"../constants/')
      .replaceAll('"../../src/virtual-try-on-3d/', '"../virtual-try-on-3d/');
    assert.equal(createHash("sha256").update(text).digest("hex"), expected);
  }
});
const HISTORICAL_HASHES = {
  "v1": "35c6f7b5a7ce1738dc3cf7db5788509c1ee6345091782863f886df86e784c9c6",
  "v2": "a7bc8cab52a6cc2795194acd5fad8b98132497a3adea48c523fdc2995ede50f7"
};
