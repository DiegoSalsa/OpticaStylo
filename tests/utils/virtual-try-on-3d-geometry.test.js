import assert from "node:assert/strict";
import test from "node:test";

import {
  landmarksToGlassesPose,
  smoothGlassesPose3D,
} from "../../src/utils/virtual-try-on-3d-geometry.js";

function faceLandmarks() {
  const landmarks = Array.from({ length: 455 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[33] = { x: 0.35, y: 0.4, z: 0 };
  landmarks[263] = { x: 0.65, y: 0.4, z: 0 };
  landmarks[6] = { x: 0.5, y: 0.43, z: 0 };
  landmarks[1] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[10] = { x: 0.5, y: 0.2, z: 0 };
  landmarks[152] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[234] = { x: 0.25, y: 0.51, z: 0 };
  landmarks[454] = { x: 0.75, y: 0.51, z: 0 };
  return landmarks;
}

test("calcula el calce desde el ancho real del rostro", () => {
  const pose = landmarksToGlassesPose(faceLandmarks(), 1000, 500);
  assert.equal(pose.scale, 580);
  assert.equal(pose.position[0], 0);
  assert.equal(pose.position[1], 42.5);
  assert.equal(pose.rotation[1], Math.PI);
  assert.equal(pose.rotation[2], 0);
  assert.deepEqual(pose.occluder.scale, [250, 159, 170]);
  assert.ok(pose.occluder.position[2] < -pose.occluder.scale[2]);
  const templeInnerEdgeRatio = 0.061621711730957034 / 0.13875067138671876;
  assert.ok(pose.scale * templeInnerEdgeRatio > pose.occluder.scale[0]);
});

test("mantiene el ancho proyectado cuando el rostro gira", () => {
  const frontal = landmarksToGlassesPose(faceLandmarks(), 1000, 500);
  const turnedLandmarks = faceLandmarks();
  turnedLandmarks[1].x = 0.45;
  const turned = landmarksToGlassesPose(turnedLandmarks, 1000, 500);
  const yaw = turned.headRotation[1];
  assert.ok(yaw > 0.35);
  assert.ok(Math.abs(turned.scale * Math.cos(yaw) - frontal.scale) < 0.0001);
});

test("refleja la posición horizontal para acompañar el video espejo", () => {
  const landmarks = faceLandmarks();
  for (const index of [33, 263, 6, 1, 10, 152, 234, 454]) {
    landmarks[index].x -= 0.1;
  }
  const pose = landmarksToGlassesPose(landmarks, 1000, 500);
  assert.equal(pose.position[0], 100);
  assert.equal(pose.occluder.position[0], 100);
});

test("rechaza puntos incompletos y suaviza también la máscara facial", () => {
  assert.equal(landmarksToGlassesPose([], 1000, 500), null);
  const previous = landmarksToGlassesPose(faceLandmarks(), 1000, 500);
  const nextLandmarks = faceLandmarks();
  for (const index of [33, 263, 6, 1, 10, 152, 234, 454]) {
    nextLandmarks[index].x -= 0.05;
  }
  const next = landmarksToGlassesPose(nextLandmarks, 1000, 500);
  const pose = smoothGlassesPose3D(previous, next, 0.5);
  assert.equal(pose.position[0], 25);
  assert.equal(pose.occluder.position[0], 25);
  assert.equal(pose.scale, 580);
});
