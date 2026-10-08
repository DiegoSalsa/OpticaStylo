import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { cameraProjection, unprojectVideoPoint, coverRectangle } from "../../src/virtual-try-on-3d/camera-projection.js";
import { faceLandmarks } from "../fixtures/vto-fixtures.js";

const metadata = JSON.parse(readFileSync(new URL("../../public/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.tryon.json", import.meta.url)));
const pose = (options = {}, adjustment = null) => {
  const { landmarks, transform } = faceLandmarks(options);
  return landmarksToGlassesPose(landmarks, 1000, 500, metadata, transform, adjustment);
};
test("bridgeSeat se apoya en nariz sin offset ni yaw de modelo", () => {
  const p = pose(); assert.deepEqual(p.position, [0, 35, 0]);
  assert.ok(p.rotation.every((v) => Math.abs(v) < 1e-8)); assert.ok(Math.abs(p.scale - 500 / 135) < 1e-8);
  assert.deepEqual(Array.from(p.faceMesh.positions.slice(18, 21)), [0, 0, 0]);
});
for (const axis of ["yaw", "pitch", "roll"]) for (const angle of [-Math.PI / 4, -0.26, 0.26, Math.PI / 4]) {
  test(`pose ${axis} ${angle.toFixed(2)} respeta matriz y espejo`, () => {
    const p = pose({ [axis]: angle });
    const expected = new Quaternion().setFromEuler(new Euler(axis === "pitch" ? angle : 0,
      axis === "yaw" ? -angle : 0, axis === "roll" ? -angle : 0));
    assert.ok(expected.angleTo(new Quaternion().fromArray(p.quaternion)) < 1e-6);
    assert.deepEqual(p.position, [0, 35, 0]);
    assert.ok(Math.abs(p.scale / pose().scale - 1) < 1e-6);
  });
}
test("matriz tipada y fallback 3D producen el mismo giro", () => {
  const f = faceLandmarks({ yaw: 0.5, roll: 0.15 });
  const typed = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, { data: new Float32Array(f.transform.data) });
  const fallback = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata);
  assert.ok(new Quaternion().fromArray(typed.quaternion).angleTo(new Quaternion().fromArray(fallback.quaternion)) < 0.03);
});
for (const zoom of [0.65, 1.4]) test(`cerca/lejos zoom ${zoom} conserva mm y anclaje`, () => {
  assert.ok(Math.abs(pose({ zoom }).scale / pose().scale - zoom) < 1e-6);
  assert.deepEqual(pose({ zoom }).position, [0, 35, 0]);
});
test("movimiento ocular y ruido de iris no afectan posición ni escala", () => {
  const f = faceLandmarks(), initial = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform);
  for (let i = 468; i < 478; i++) f.landmarks[i] = { x: Math.sin(i), y: Math.cos(i), z: 0.8 };
  const after = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform);
  assert.deepEqual(after.position, initial.position); assert.equal(after.scale, initial.scale); assert.deepEqual(after.quaternion, initial.quaternion);
});
test("modelo de 148 mm conserva diferencia respecto a 137 mm", () => {
  const f = faceLandmarks(), larger = structuredClone(metadata); larger.dimensionsMm.frameWidth = 148;
  const a = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform);
  const b = landmarksToGlassesPose(f.landmarks, 1000, 500, larger, f.transform);
  assert.equal(a.scale, b.scale); assert.ok(b.scale * 148 > a.scale * 137);
});
test("traslación y espejo afectan sólo posición; foto conserva lateralidad", () => {
  assert.equal(pose({ x: -100 }).position[0], 100);
  assert.equal(pose({ x: -100 }, { mirrored: false }).position[0], -100);
  assert.ok(pose({ x: -100 }).faceMesh.positions.slice(18, 21).every((v) => Math.abs(v) < 1e-8));
});
test("rechaza pérdida, landmarks incompletos y datos no finitos", () => {
  for (const landmarks of [null, [], Array(468).fill({ x: NaN, y: 0, z: 0 })]) assert.equal(landmarksToGlassesPose(landmarks, 1000, 500, metadata), null);
});
test("perspectiva reproyecta nariz y superficie facial a los píxeles fuente", () => {
  const projection = cameraProjection(1000, 500), p = unprojectVideoPoint(680, 190, -80, projection);
  const ratio = projection.focalPx / (projection.focalPx - p[2]);
  assert.ok(Math.abs(p[0] * ratio + 500 - 680) < 1e-8);
  assert.ok(Math.abs(250 - p[1] * ratio - 190) < 1e-8);
  const face = faceLandmarks({ yaw: 0.5 }), fitted = landmarksToGlassesPose(face.landmarks, 1000, 500, metadata, face.transform);
  const matrix = new Matrix4().compose(new Vector3().fromArray(fitted.position), new Quaternion().fromArray(fitted.quaternion), new Vector3().setScalar(fitted.scale));
  const cheek = new Vector3().fromArray(fitted.faceMesh.positions, 234 * 3).applyMatrix4(matrix);
  const screenX = cheek.x * 1000 / (1000 - cheek.z) + 500;
  assert.ok(Math.abs(screenX - (1 - face.landmarks[234].x) * 1000) < 0.001);
});
for (const [width, height, sourceAspect] of [[635, 391, 0.8], [390, 510, 16 / 9], [580, 725, 0.8]]) {
  test(`cover ${width}×${height}, fuente ${sourceAspect}: video/canvas misma proyección`, () => {
    const rect = coverRectangle(width, height, sourceAspect);
    assert.ok(rect.width >= width); assert.ok(rect.height >= height);
    assert.ok(Math.abs(rect.width / rect.height - sourceAspect) < 1e-8);
    assert.equal(rect.left + rect.width / 2, width / 2); assert.equal(rect.top + rect.height / 2, height / 2);
  });
}
