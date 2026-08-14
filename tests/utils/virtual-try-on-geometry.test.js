import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAutomaticFramePose,
  calculateManualFramePose,
  smoothFramePose,
} from "../../src/utils/virtual-try-on-geometry.js";

const calibration = {
  rotationOffsetDegrees: 0,
  verticalOffset: 0,
  widthScale: 2,
};
const adjustments = {
  rotationDegrees: 0,
  scale: 1,
  verticalOffset: 0,
};

test("calcula el marco usando las esquinas exteriores de los ojos", () => {
  const landmarks = Array.from({ length: 264 }, () => ({ x: 0, y: 0 }));
  landmarks[33] = { x: 0.3, y: 0.4 };
  landmarks[263] = { x: 0.7, y: 0.4 };
  const pose = calculateAutomaticFramePose({
    adjustments,
    calibration,
    height: 500,
    landmarks,
    width: 1000,
  });
  assert.deepEqual(pose, { angle: 0, centerX: 500, centerY: 200, width: 800 });
});

test("mantiene un modo manual utilizable sin detección facial", () => {
  const pose = calculateManualFramePose({
    adjustments: { ...adjustments, scale: 0.8, verticalOffset: 0.1 },
    calibration,
    height: 800,
    width: 600,
  });
  assert.equal(pose.centerX, 300);
  assert.equal(pose.centerY, 356);
  assert.equal(pose.width, 297.6);
});

test("suaviza cambios de posición sin saltar al cruzar 180 grados", () => {
  const previous = { angle: Math.PI - 0.1, centerX: 0, centerY: 0, width: 100 };
  const next = { angle: -Math.PI + 0.1, centerX: 10, centerY: 20, width: 120 };
  const pose = smoothFramePose(previous, next, 0.5);
  assert.ok(Math.abs(pose.angle - Math.PI) < 0.0001);
  assert.equal(pose.centerX, 5);
  assert.equal(pose.centerY, 10);
  assert.equal(pose.width, 110);
});
