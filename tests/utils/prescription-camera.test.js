import assert from "node:assert/strict";
import test from "node:test";

import {
  getCameraConstraints,
  getCameraErrorMessage,
  nextCameraFacingMode,
} from "../../src/utils/prescription-camera.js";

test("prioriza la cámara trasera para fotografiar una receta", () => {
  assert.deepEqual(getCameraConstraints(), {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      height: { ideal: 1440 },
      width: { ideal: 1920 },
    },
  });
});

test("permite alternar entre las cámaras disponibles", () => {
  assert.equal(nextCameraFacingMode("environment"), "user");
  assert.equal(nextCameraFacingMode("user"), "environment");
});

test("explica los errores habituales de permisos y cámara", () => {
  assert.match(getCameraErrorMessage({ name: "NotAllowedError" }), /permiso fue rechazado/i);
  assert.match(getCameraErrorMessage({ name: "NotFoundError" }), /No encontramos una cámara/i);
});
