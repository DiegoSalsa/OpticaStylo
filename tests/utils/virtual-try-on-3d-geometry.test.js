import assert from "node:assert/strict";
import test from "node:test";

import {
  landmarksToGlassesPose,
  smoothGlassesPose3D,
} from "../../src/utils/virtual-try-on-3d-geometry.js";

const calibration = {
  positionOffsetX: 0,
  positionOffsetY: 0,
  positionOffsetZ: 0,
  rotationOffsetX: 0,
  rotationOffsetY: 180,
  rotationOffsetZ: 0,
  widthScale: 2.25,
};

function faceLandmarks() {
  const landmarks = Array.from({ length: 264 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[33] = { x: 0.35, y: 0.4, z: 0 };
  landmarks[263] = { x: 0.65, y: 0.4, z: 0 };
  landmarks[6] = { x: 0.5, y: 0.43, z: 0 };
  landmarks[1] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[10] = { x: 0.5, y: 0.2, z: 0 };
  landmarks[152] = { x: 0.5, y: 0.8, z: 0 };
  return landmarks;
}

test("normaliza el ancho 3D a la distancia entre los ojos", () => {
  const pose = landmarksToGlassesPose(faceLandmarks(), 1000, 500, calibration);
  assert.equal(pose.scale, 675);
  assert.equal(pose.position[0], 0);
  assert.equal(pose.position[1], 50);
  assert.equal(pose.rotation[1], Math.PI);
  assert.equal(pose.rotation[2], 0);
});

test("refleja la posición horizontal para acompañar el video espejo", () => {
  const landmarks = faceLandmarks();
  landmarks[33].x -= 0.1;
  landmarks[263].x -= 0.1;
  landmarks[6].x -= 0.1;
  landmarks[1].x -= 0.1;
  const pose = landmarksToGlassesPose(landmarks, 1000, 500, calibration);
  assert.equal(pose.position[0], 100);
});

test("rechaza puntos incompletos y suaviza pose, giro y escala", () => {
  assert.equal(landmarksToGlassesPose([], 1000, 500, calibration), null);
  const pose = smoothGlassesPose3D(
    { position: [0, 0, 0], rotation: [0, Math.PI - 0.1, 0], scale: 100 },
    { position: [10, 20, 30], rotation: [0, -Math.PI + 0.1, 0], scale: 120 },
    0.5,
  );
  assert.deepEqual(pose.position, [5, 10, 15]);
  assert.ok(Math.abs(pose.rotation[1] - Math.PI) < 0.0001);
  assert.equal(pose.scale, 110);
});
