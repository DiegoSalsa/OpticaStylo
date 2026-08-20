import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  landmarksToGlassesPose,
  smoothGlassesPose3D,
} from "../../src/utils/virtual-try-on-3d-geometry.js";

const modelMetadata = JSON.parse(readFileSync(new URL(
  "../../public/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.tryon.json",
  import.meta.url,
), "utf8"));

function faceLandmarks() {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[33] = { x: 0.35, y: 0.4, z: 0 };
  landmarks[263] = { x: 0.65, y: 0.4, z: 0 };
  landmarks[6] = { x: 0.5, y: 0.43, z: 0 };
  landmarks[1] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[10] = { x: 0.5, y: 0.2, z: 0 };
  landmarks[152] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[234] = { x: 0.25, y: 0.51, z: 0 };
  landmarks[454] = { x: 0.75, y: 0.51, z: 0 };
  landmarks[127] = { x: 0.28, y: 0.36, z: 0 };
  landmarks[356] = { x: 0.72, y: 0.36, z: 0 };
  landmarks[468] = { x: 0.38, y: 0.4, z: 0 };
  landmarks[473] = { x: 0.62, y: 0.4, z: 0 };
  return landmarks;
}

function yawTransform(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    columns: 4,
    data: [
      cosine, 0, -sine, 0,
      0, 1, 0, 0,
      sine, 0, cosine, 0,
      0, 0, 0, 1,
    ],
    rows: 4,
  };
}

test("calcula una escala física sin ajustes específicos del marco", () => {
  const pose = landmarksToGlassesPose(faceLandmarks(), 1000, 500, modelMetadata);
  assert.ok(Math.abs(pose.scale - (500 / 135)) < 0.000001);
  assert.equal(pose.position[0], 0);
  assert.ok(Math.abs(pose.position[1] - (50 - (2 * 500 / 135))) < 0.000001);
  assert.equal(pose.rotation[1], Math.PI);
  assert.equal(pose.rotation[2], 0);
  assert.equal(pose.faceMesh.positions.length, 468 * 3);
  assert.ok(Math.abs(
    pose.faceMesh.positions[6 * 3 + 2]
      + modelMetadata.occlusion.maskFrontDepthMm * pose.scale,
  ) < 0.00001);
});

test("conserva las diferencias físicas entre marcos", () => {
  const smallFrame = landmarksToGlassesPose(faceLandmarks(), 1000, 500, modelMetadata);
  const largeMetadata = structuredClone(modelMetadata);
  largeMetadata.dimensionsMm.frameWidth = 150;
  const largeFrame = landmarksToGlassesPose(faceLandmarks(), 1000, 500, largeMetadata);

  assert.equal(smallFrame.scale, largeFrame.scale);
  assert.ok(
    largeFrame.scale * largeMetadata.dimensionsMm.frameWidth
      > smallFrame.scale * modelMetadata.dimensionsMm.frameWidth,
  );
});

test("mantiene la escala frontal cuando el rostro gira", () => {
  const frontal = landmarksToGlassesPose(faceLandmarks(), 1000, 500, modelMetadata);
  const turnedLandmarks = faceLandmarks();
  turnedLandmarks[1].x = 0.45;
  const turned = landmarksToGlassesPose(turnedLandmarks, 1000, 500, modelMetadata);
  const yaw = turned.headRotation[1];
  assert.ok(yaw > 0.35);
  assert.ok(Math.abs(turned.scale * Math.cos(yaw) - frontal.scale) < 0.0001);
});

test("usa la matriz facial 3D para mantener el giro del marco", () => {
  const turnedLandmarks = faceLandmarks();
  turnedLandmarks[1].x = 0.45;
  const pose = landmarksToGlassesPose(
    turnedLandmarks,
    1000,
    500,
    modelMetadata,
    yawTransform(0.5),
  );
  assert.ok(Math.abs(pose.headRotation[1] - 0.5) < 0.000001);
  assert.ok(Math.abs(pose.rotation[1] - (Math.PI + 0.5)) < 0.000001);
});

test("refleja la posición horizontal para acompañar el video espejo", () => {
  const landmarks = faceLandmarks();
  for (const index of [33, 263, 6, 1, 10, 152, 234, 454, 127, 356, 468, 473]) {
    landmarks[index].x -= 0.1;
  }
  const pose = landmarksToGlassesPose(landmarks, 1000, 500, modelMetadata);
  assert.equal(pose.position[0], 100);
  assert.equal(pose.faceMesh.positions[234 * 3], 350);
});

test("rechaza datos incompletos y suaviza también el oclusor", () => {
  assert.equal(landmarksToGlassesPose([], 1000, 500, modelMetadata), null);
  const previous = landmarksToGlassesPose(faceLandmarks(), 1000, 500, modelMetadata);
  const nextLandmarks = faceLandmarks();
  for (const index of [33, 263, 6, 1, 10, 152, 234, 454, 127, 356, 468, 473]) {
    nextLandmarks[index].x -= 0.05;
  }
  const next = landmarksToGlassesPose(nextLandmarks, 1000, 500, modelMetadata);
  const pose = smoothGlassesPose3D(previous, next, 0.5);
  assert.equal(pose.position[0], 25);
  assert.equal(
    pose.faceMesh.positions[234 * 3],
    (previous.faceMesh.positions[234 * 3] + next.faceMesh.positions[234 * 3]) / 2,
  );
  assert.ok(Math.abs(pose.scale - previous.scale) < 0.000001);
});
