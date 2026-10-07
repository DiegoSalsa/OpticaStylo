import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { PoseFilter } from "../../src/virtual-try-on-3d/pose-filter.js";
import { measureVideoInference, TrackingDiagnostics } from "../../src/virtual-try-on-3d/tracking-diagnostics.js";
import { faceLandmarks } from "../fixtures/vto-fixtures.js";

const metadata = JSON.parse(readFileSync(new URL("../../public/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.tryon.json", import.meta.url)));
for (const [reason, mutate] of [
  ["missing-metadata", (input) => { input.metadata = null; }],
  ["no-landmarks", (input) => { input.landmarks = null; }],
  ["invalid-video-dimensions", (input) => { input.width = 0; }],
  ["landmark-count", (input) => { input.landmarks.length = 30; }],
  ["invalid-landmarks", (input) => { input.landmarks[6].x = NaN; }],
  ["invalid-quaternion", (input) => { input.transform = null; input.landmarks[10] = { ...input.landmarks[152] }; }],
  ["eye-distance", (input) => { input.landmarks[33] = { ...input.landmarks[263] }; }],
  ["face-width", (input) => { input.landmarks[234] = { ...input.landmarks[454] }; }],
]) test(`pose rechazada conserva umbral y expone reason ${reason}`, () => {
  const face = faceLandmarks(), input = { ...face, metadata, width: 1000, height: 500 };
  mutate(input); const diagnostics = { reason: "previous" };
  assert.equal(landmarksToGlassesPose(input.landmarks, input.width, input.height, input.metadata, input.transform, null, diagnostics), null);
  assert.equal(diagnostics.reason, reason);
});

test("diagnóstico no modifica la pose válida ni conserva reason anterior", () => {
  const f = faceLandmarks({ yaw: 0.3 }), diagnostic = { reason: "eye-distance" };
  const a = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform);
  const b = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform, null, diagnostic);
  assert.deepEqual(a, b); assert.equal(diagnostic.reason, null);
});

test("fallback síncrono mide 220ms de SDK, separado del tiempo de recepción", async () => {
  let now = 0;
  const measured = await measureVideoInference({ detectForVideo() { now += 220; return { faceLandmarks: [] }; } }, {}, 0, () => now);
  assert.equal(measured.sdkExecutionTimeMs, 220); assert.equal(now, 220);
});

test("worker usa duración SDK reportada, no la invocación asíncrona en main", async () => {
  let now = 0;
  const measured = await measureVideoInference({ detectForVideo() { now += 1; return Promise.resolve({ faceLandmarks: [], inferenceDurationMs: 160 }); } }, {}, 0, () => now);
  assert.equal(measured.sdkExecutionTimeMs, 160);
});

test("contadores distinguen SDK sin rostro, rechazo de pose y rechazo temporal", () => {
  const diagnostic = new TrackingDiagnostics(), filter = new PoseFilter();
  diagnostic.recordInference({ faceLandmarks: [] }, null, 20);
  diagnostic.recordInference({ faceLandmarks: [faceLandmarks().landmarks] }, null, 220);
  diagnostic.recordPose(null, "face-width");
  filter.update(null, 0, 220); filter.update(null, 0, 300);
  const metrics = diagnostic.metrics(filter.metrics(300));
  assert.equal(metrics.inferenceCount, 2); assert.equal(metrics.noFaceResultCount, 1);
  assert.equal(metrics.faceResultCount, 1); assert.equal(metrics.poseConversionRejectedCount, 1);
  assert.equal(metrics.poseFilterRejectedCount, 1); assert.equal(metrics.poseRejectedCount, 2);
  assert.equal(metrics.poseRejectReason, "stale-measurement");
  assert.equal(metrics.inferenceDurationMs, 220); assert.equal(metrics.smoothedInferenceDurationMs, 60);
});

test("errores SDK no se cuentan como respuestas con cero rostros", () => {
  const d = new TrackingDiagnostics(); d.recordInference(undefined, new Error("SDK"), 300);
  assert.equal(d.values.inferenceCount, 1); assert.equal(d.values.noFaceResultCount, 0);
  assert.equal(d.values.inferenceErrorCount, 1); assert.equal(d.values.poseRejectReason, "inference-error");
});
