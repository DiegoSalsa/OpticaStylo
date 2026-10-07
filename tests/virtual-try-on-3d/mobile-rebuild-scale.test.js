import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Euler, Matrix4, Quaternion } from "three";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { rebuildFace, desktopFingerprint } from "../fixtures/rebuild-face.js";

const baseline = JSON.parse(readFileSync(new URL("../fixtures/vto-approved-desktop.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../../public/virtual-try-on/models/RB2140-901-50-v2.19.tryon.json", import.meta.url)));
const resolutions = [[1280, 720], [640, 360], [1920, 1080], [720, 1280], [480, 853], [360, 640]];
test("desktop: pose completa, máscara, patillas y filtro contra EXACTAMENTE 7290abc", () => {
  for (const [name, expected] of Object.entries(baseline.models)) {
    const model = JSON.parse(readFileSync(new URL(`../../public/virtual-try-on/models/${name}.tryon.json`, import.meta.url)));
    assert.equal(desktopFingerprint(landmarksToGlassesPose, model), expected);
  }
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../src/virtual-try-on-3d/pose-filter.js", import.meta.url))).digest("hex"), baseline.poseFilterSha256);
});
for (const yaw of [-0.785, 0, 0.785]) for (const mirrored of [true, false]) test(`ratio invariante a seis fuentes: yaw=${yaw}, mirror=${mirrored}`, () => {
  let reference;
  for (const [w, h] of resolutions) {
    const f = rebuildFace(w, h, { yaw, pitch: 0.15, roll: 0.08 });
    const p = landmarksToGlassesPose(f.landmarks, w, h, metadata, f.transform, { mirrored });
    reference ??= p.diagnostics.frameToFaceRatio;
    assert.ok(Math.abs(p.diagnostics.frameToFaceRatio - reference) < 1e-12);
    assert.equal(p.diagnostics.videoWidth, w); assert.equal(p.diagnostics.videoHeight, h);
  }
});
for (const [w, h] of resolutions) test(`matriz yaw70 absurda sobre cara frontal ${w}×${h}`, () => {
  const f = rebuildFace(w, h);
  const bad = { data: new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromEuler(new Euler(0, 70 * Math.PI / 180, 0))).toArray() };
  const p = landmarksToGlassesPose(f.landmarks, w, h, metadata, bad);
  assert.equal(p.diagnostics.matrixRejected, true);
  assert.ok(p.diagnostics.matrixCorrectionFactor > 2.85);
  assert.ok(p.diagnostics.projectionLength > 0.999);
  assert.ok(Math.abs(p.scale - w * 0.25 / 135) < 0.001);
});
for (const signal of [234, 454, 127, 356, 33, 263]) test(`una señal corrupta ${signal} no infla escala`, () => {
  const f = rebuildFace(720, 1280), before = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
  f.landmarks[signal].x += signal === 234 || signal === 127 || signal === 33 ? -0.25 : 0.25;
  const after = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
  assert.ok(after); assert.ok(Math.abs(after.scale / before.scale - 1) < 0.01);
});
for (const yaw of [-0.52, 0.52]) test(`cheek corrupto durante giro ${yaw} conserva consenso`, () => {
  const f = rebuildFace(720, 1280, { yaw, pitch: 0.15, roll: 0.08 });
  const before = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
  f.landmarks[234].x -= 0.3;
  const after = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
  assert.equal(after.diagnostics.scaleSource, "eyes-temples-consensus");
  assert.ok(Math.abs(after.scale / before.scale - 1) < 0.01);
});
test("roll90 incompatible y matriz no finita recuperan base geométrica, sin rama portrait", () => {
  for (const [w,h] of [[1280,720],[720,1280]]) {
    const f = rebuildFace(w,h), badRoll = { data: new Matrix4().makeRotationZ(Math.PI / 2).toArray() };
    const p = landmarksToGlassesPose(f.landmarks,w,h,metadata,badRoll);
    assert.equal(p.diagnostics.matrixRejected,true); assert.equal(p.diagnostics.projectionLength,1);
    const invalid = landmarksToGlassesPose(f.landmarks,w,h,metadata,{ data: Array(16).fill(NaN) });
    assert.equal(invalid.diagnostics.orientationSource,"landmarks"); assert.equal(invalid.diagnostics.projectionLength,1);
  }
});
test("iris y tamaño CSS no son entradas de escala; mismo modelo conserva mm", () => {
  const f = rebuildFace(720, 1280), a = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
  f.landmarks.push(...Array.from({ length: 10 }, () => ({ x: 100, y: -50, z: 20 })));
  const b = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform, { viewerWidth: 300, viewerHeight: 900 });
  assert.equal(a.scale, b.scale); assert.equal(a.diagnostics.modelFrameWidthMm, metadata.dimensionsMm.frameWidth);
});
