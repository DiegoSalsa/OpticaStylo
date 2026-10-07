import assert from "node:assert/strict";
import test from "node:test";
import { mediaRectangle } from "../../src/virtual-try-on-3d/camera-viewport.js";
import { coverRectangle } from "../../src/virtual-try-on-3d/camera-projection.js";
import { cameraStreamConstraints, cameraStreamDiagnostics } from "../../src/virtual-try-on-3d/camera-stream.js";

const sources = [[1920, 1080], [1280, 720], [640, 480], [720, 1280], [1080, 1920]];
const viewers = [[390, 490], [390, 700], [430, 600], [844, 390], [1280, 720]];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);

for (const [sw, sh] of sources) for (const [vw, vh] of viewers) {
  test(`contain: fuente ${sw}×${sh}, viewer ${vw}×${vh}, todos los bordes visibles`, () => {
    const r = mediaRectangle(vw, vh, sw / sh, "contain");
    assert.ok(r.width <= vw + 1e-8 && r.height <= vh + 1e-8);
    assert.ok(r.left >= -1e-8 && r.top >= -1e-8);
    close(r.width / r.height, sw / sh);
    close(r.left + r.width / 2, vw / 2); close(r.top + r.height / 2, vh / 2);
    // Source corners and an interior landmark share the same canvas/video map.
    for (const [x, y] of [[0, 0], [sw, 0], [0, sh], [sw, sh], [sw * 0.31, sh * 0.67]]) {
      const screenX = r.left + x / sw * r.width, screenY = r.top + y / sh * r.height;
      assert.ok(screenX >= -1e-8 && screenX <= vw + 1e-8);
      assert.ok(screenY >= -1e-8 && screenY <= vh + 1e-8);
      // A full-resolution capture preserves the source pixel, without bands or stretch.
      close((screenX - r.left) / r.width * sw, x);
      close((screenY - r.top) / r.height * sh, y);
    }
  });
  test(`cover: fuente ${sw}×${sh}, viewer ${vw}×${vh}, regresión desktop`, () => {
    const r = mediaRectangle(vw, vh, sw / sh, "cover");
    assert.deepEqual(r, coverRectangle(vw, vh, sw / sh));
    assert.ok(r.width >= vw - 1e-8 && r.height >= vh - 1e-8);
    close(r.width / r.height, sw / sh);
    close(r.left + r.width / 2, vw / 2); close(r.top + r.height / 2, vh / 2);
  });
}

for (const [sw, sh] of sources) test(`rotación dinámica y cambio de resolución: ${sw}×${sh}`, () => {
  const portrait = mediaRectangle(390, 700, sw / sh, "contain");
  const landscape = mediaRectangle(844, 390, sw / sh, "contain");
  const rotatedSource = mediaRectangle(844, 390, sh / sw, "contain");
  assert.notDeepEqual(portrait, landscape);
  close(rotatedSource.width / rotatedSource.height, sh / sw);
  assert.ok(rotatedSource.width <= 844 && rotatedSource.height <= 390);
  assert.deepEqual(mediaRectangle(390, 700, sw / sh, "contain"), portrait);
});

test("un stream horizontal con cover en portrait pierde más de la mitad de su ancho", () => {
  const r = mediaRectangle(390, 490, 16 / 9, "cover");
  close(r.width, 490 * 16 / 9);
  assert.ok(390 / r.width < 0.45);
  assert.equal(mediaRectangle(390, 490, 16 / 9, "contain").width, 390);
});

test("esperar dimensiones válidas no genera NaN ni infinidades", () => {
  for (const args of [[0, 0, 16 / 9], [390, 0, 1], [390, 490, 0], [390, 490, NaN]]) {
    assert.deepEqual(mediaRectangle(...args, "contain"), { width: 0, height: 0, left: 0, top: 0 });
  }
  assert.throws(() => mediaRectangle(390, 490, 1, "stretch"), /encuadre/);
});

test("constraints desktop conservan resolución, ratio y cadencia aprobados", () => {
  assert.deepEqual(cameraStreamConstraints("user", false, { resizeMode: true }), { audio: false, video: {
    facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 60, max: 60 },
  } });
});

test("constraints móviles no fuerzan altura, ratio, zoom ni APIs no soportadas", () => {
  for (const supported of [{}, { resizeMode: false }, { resizeMode: true }]) {
    const { video } = cameraStreamConstraints("user", true, supported);
    assert.equal(video.height, undefined); assert.equal(video.aspectRatio, undefined);
    assert.equal(video.zoom, undefined); assert.equal(video.width.ideal, 1280);
    assert.deepEqual(video.frameRate, { ideal: 30, max: 30 });
    assert.deepEqual(video.resizeMode, supported.resizeMode ? { ideal: "none" } : undefined);
  }
});

test("user → environment → user genera constraints nuevos sin conservar la cámara anterior", () => {
  const requests = ["user", "environment", "user"].map((mode) => cameraStreamConstraints(mode, true));
  assert.deepEqual(requests.map((r) => r.video.facingMode.ideal), ["user", "environment", "user"]);
  requests[1].video.width.ideal = 640;
  assert.equal(requests[2].video.width.ideal, 1280);
});

test("debug usa dimensiones reales y capabilities reales sin aplicar zoom", () => {
  const track = { getSettings: () => ({ width: 640, height: 480, aspectRatio: 4 / 3, frameRate: 30, facingMode: "user", zoom: 2, deviceId: "private" }),
    getCapabilities: () => ({ zoom: { min: 1, max: 4 }, width: { min: 640, max: 1920 }, deviceId: "private" }) };
  const requested = cameraStreamConstraints("user", true);
  const d = cameraStreamDiagnostics({ videoWidth: 640, videoHeight: 480 }, track, requested);
  assert.equal(d.requestedConstraints, requested); assert.equal(d.videoWidth, 640);
  close(d.videoAspectRatio, 4 / 3); assert.equal(d.settings.frameRate, 30);
  assert.deepEqual(d.zoom, { current: 2, min: 1, max: 4 });
  assert.equal(d.settings.deviceId, undefined); assert.equal(d.capabilities.deviceId, undefined);
});

test("debug tolera APIs opcionales ausentes o que lanzan errores", () => {
  for (const track of [null, {}, { getSettings() { throw new Error(); }, getCapabilities() { throw new Error(); } }]) {
    const d = cameraStreamDiagnostics(null, track);
    assert.equal(d.settings, null); assert.equal(d.capabilities, null);
    assert.equal(d.videoAspectRatio, null); assert.equal(d.actualFacingMode, null);
    assert.deepEqual(d.zoom, { current: null, min: null, max: null });
  }
});

test("debug descarta valores de stream anterior al cambiar cámara o rotar", () => {
  const read = (mode, width, height) => cameraStreamDiagnostics({ videoWidth: width, videoHeight: height },
    { getSettings: () => ({ facingMode: mode, width, height }) }, cameraStreamConstraints(mode, true));
  assert.equal(read("user", 720, 1280).videoAspectRatio, 720 / 1280);
  assert.equal(read("environment", 1920, 1080).actualFacingMode, "environment");
  assert.equal(read("user", 640, 480).videoWidth, 640);
  assert.equal(read("user", 640, 480).capabilities, null);
});
