import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Euler, Matrix4, Quaternion } from "three";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { faceLandmarks } from "../fixtures/vto-fixtures.js";

const metadata = JSON.parse(readFileSync(new URL("../../public/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.tryon.json", import.meta.url)));
const sizes = [[1920, 1080], [1280, 720], [960, 540], [640, 360], [720, 1280], [480, 853], [360, 640]];
function faceAtSize(width, height, options) {
  const f = faceLandmarks(options);
  f.landmarks = f.landmarks.map((p) => ({ ...p, y: 0.5 + (p.y - 0.5) * width / height / 2 }));
  return f;
}
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

for (const mirrored of [false, true]) for (const yaw of [-Math.PI / 6, 0, Math.PI / 6]) {
  for (const [width, height] of sizes) test(`${width}x${height}, mirror ${mirrored}, yaw ${yaw}: física y orientación invariantes`, () => {
    const f = faceAtSize(width, height, { yaw, pitch: 0.1, roll: 0.08 });
    const diagnostic = {}, p = landmarksToGlassesPose(f.landmarks, width, height, metadata, f.transform, { mirrored }, diagnostic);
    const base = faceAtSize(1280, 720, { yaw, pitch: 0.1, roll: 0.08 });
    const q = landmarksToGlassesPose(base.landmarks, 1280, 720, metadata, base.transform, { mirrored });
    close(p.scale / width, q.scale / 1280);
    for (let i = 0; i < 4; i++) close(p.quaternion[i], q.quaternion[i]);
    for (const side of ["left", "right"]) close(p.templeFit[side].bendRadians, q.templeFit[side].bendRadians);
    assert.equal(diagnostic.orientationSource, "matrix");
    close(diagnostic.yaw, mirrored ? -yaw * 180 / Math.PI : yaw * 180 / Math.PI, 0.001);
    close(diagnostic.pitch, 0.1 * 180 / Math.PI, 0.001);
    close(diagnostic.roll, (mirrored ? -1 : 1) * 0.08 * 180 / Math.PI, 0.001);
  });
}

for (const [width, height] of sizes) test(`${width}x${height}: matriz yaw70 sobre rostro frontal no amplifica escala`, () => {
  const f = faceAtSize(width, height, {}), diagnostic = {};
  const bad = { data: new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromEuler(new Euler(0, 70 * Math.PI / 180, 0))).toArray() };
  const p = landmarksToGlassesPose(f.landmarks, width, height, metadata, bad, { mirrored: false }, diagnostic);
  const good = landmarksToGlassesPose(f.landmarks, width, height, metadata, f.transform, { mirrored: false });
  close(p.scale, good.scale); close(diagnostic.projectionLength, 1);
  close(diagnostic.matrixProjectionLength, Math.cos(70 * Math.PI / 180));
  assert.equal(diagnostic.orientationSource, "landmarks-consistency");
  assert.ok(diagnostic.matrixCorrectionFactor > 2.8);
});

test("matriz con rotación portrait espuria se contrasta por geometría, sin branch móvil", () => {
  const f = faceAtSize(720, 1280, {}), d = {};
  const bad = { data: new Matrix4().makeRotationZ(Math.PI / 2).toArray() };
  const p = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, bad, null, d);
  assert.equal(d.orientationSource, "landmarks-consistency"); assert.ok(Math.abs(p.headRotation[2]) < 0.01);
});

for (const focalRatio of [0.7, 1, 1.3]) test(`variación focal ${focalRatio}: frente no duplica ancho ni escala`, () => {
  const f = faceAtSize(720, 1280, {}), d = {};
  const p = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform, { focalPx: 720 * focalRatio }, d);
  const base = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
  assert.ok(Math.abs(p.scale / base.scale - 1) < 0.03);
  close(d.correctionFactor, 1);
  assert.ok(Number.isFinite(p.templeFit.proxy.radii[0]));
});

test("sin matriz, landmarks mantienen escala relativa en portrait y landscape", () => {
  const results = sizes.map(([w, h]) => {
    const f = faceAtSize(w, h, { yaw: 0.3 });
    return landmarksToGlassesPose(f.landmarks, w, h, metadata, null).scale / w;
  });
  for (const value of results) close(value, results[0]);
});
