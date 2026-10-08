import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acquireCamera, cameraConstraints, cameraTrackSnapshot, mobileCameraEnvironment, stopStream } from "../../src/virtual-try-on-3d/camera-acquisition.js";
import { framePresentation, mobileViewerDimensions, drawTryOnCapture } from "../../src/virtual-try-on-3d/frame-presentation.js";
import { cameraProjection, unprojectVideoPoint } from "../../src/virtual-try-on-3d/camera-projection.js";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { createDetectionDiagnostics, recordDetectionResult } from "../../src/virtual-try-on-3d/detection-diagnostics.js";
import { vtoBuildInfo } from "../../config/vto-build-info.mjs";
import { scaleFace } from "../fixtures/scale-face.js";

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const failure = (name) => Object.assign(new Error(name), { name });
const mockStream = (settings = {}, capabilities = {}) => {
  const state = { stops: 0, adjustments: [], settings: { ...settings } };
  const track = { getSettings: () => ({ ...state.settings }), getCapabilities: () => capabilities, getConstraints: () => ({}),
    stop: () => { state.stops++; }, applyConstraints: async (c) => {
      state.adjustments.push(c);
      if (c.resizeMode) state.settings.resizeMode = c.resizeMode.exact;
      if (c.advanced?.[0]?.zoom) state.settings.zoom = c.advanced[0].zoom;
    } };
  return { state, track, getVideoTracks: () => [track], getTracks: () => [track] };
};
const devices = (request, supported = {}) => ({ getUserMedia: request, getSupportedConstraints: () => supported });

test("desktop conserva exactamente la adquisición aprobada, incluso con zoom informado", async () => {
  const expected = { audio: false, video: { facingMode: { ideal: "user" }, aspectRatio: { ideal: 16 / 9 },
    height: { ideal: 720 }, width: { ideal: 1280 }, frameRate: { ideal: 60, max: 60 } } };
  assert.deepEqual(cameraConstraints("user", false), expected);
  const stream = mockStream({ zoom: 3 }, { zoom: { min: 1, max: 5 } });
  await acquireCamera(devices(async (c) => { assert.deepEqual(c, expected); return stream; }, { zoom: true }));
  assert.deepEqual(stream.state.adjustments, []);
});
test("móvil negocia frontal flexible, sin resolución ni aspecto obligatorios", () => {
  for (const mode of ["user", "environment"]) {
    const c = cameraConstraints(mode, true, { resizeMode: true });
    assert.deepEqual(c, { audio: false, video: { facingMode: { ideal: mode }, frameRate: { ideal: 30 }, resizeMode: { ideal: "none" } } });
    assert.deepEqual(cameraConstraints(mode, true, {}, true), { audio: false, video: { facingMode: { ideal: mode } } });
  }
});
test("detección de teléfono no depende de orientación ni confunde un notebook estrecho", () => {
  for (const [width, height] of [[390, 844], [844, 390]]) {
    assert.equal(mobileCameraEnvironment({ userAgent: "iPhone", width, height }), true);
    assert.equal(mobileCameraEnvironment({ userAgent: "Android", width, height }), true);
    assert.equal(mobileCameraEnvironment({ userAgent: "Windows", mobile: false, coarsePointer: true, width, height }), false);
    assert.equal(mobileCameraEnvironment({ userAgent: "Macintosh", coarsePointer: true, width, height }), true);
  }
  assert.equal(mobileCameraEnvironment({ userAgent: "Macintosh", coarsePointer: true, width: 1024, height: 1366 }), true);
  assert.equal(mobileCameraEnvironment({ userAgent: "Macintosh", coarsePointer: false, width: 1024, height: 1366 }), false);
});
test("fallback mínimo por constraints incompatibles, sin repetir permisos rechazados", async () => {
  const requests = [], stream = mockStream();
  await acquireCamera(devices(async (c) => { requests.push(c); if (requests.length === 1) throw failure("OverconstrainedError"); return stream; }), { mobile: true });
  assert.equal(requests.length, 2); assert.deepEqual(requests[1], cameraConstraints("user", true, {}, true));
  for (const name of ["NotAllowedError", "SecurityError", "NotReadableError", "NotFoundError"]) {
    let calls = 0;
    await assert.rejects(acquireCamera(devices(async () => { calls++; throw failure(name); }), { mobile: true }), { name });
    assert.equal(calls, 1);
  }
});
test("facing ideal ignorado libera cámara anterior y prueba exact una vez", async () => {
  const wrong = mockStream({ facingMode: "environment" }), right = mockStream({ facingMode: "user" });
  const requests = [];
  const result = await acquireCamera(devices(async (c) => { requests.push(c); if (requests.length === 1) return wrong;
    assert.ok(wrong.state.stops > 0); return right; }, { facingMode: true }), { mobile: true });
  assert.deepEqual(requests[1].video.facingMode, { exact: "user" });
  assert.equal(result.diagnostics.actualFacingMode, "user"); assert.equal(result.diagnostics.facingModeMismatch, false);
});
test("exact imposible vuelve a ideal y expone el mismatch, con intentos acotados", async () => {
  let calls = 0;
  const result = await acquireCamera(devices(async () => {
    if (++calls === 2) throw failure("OverconstrainedError"); return mockStream({ facingMode: "environment" });
  }, { facingMode: true }), { mobile: true });
  assert.equal(calls, 3); assert.equal(result.diagnostics.facingModeMismatch, true);
});
test("no inventa facing real si el navegador no lo informa", async () => {
  let calls = 0;
  const result = await acquireCamera(devices(async () => { calls++; return mockStream(); }, { facingMode: true }), { mobile: true });
  assert.equal(calls, 1); assert.equal(result.diagnostics.actualFacingMode, null);
});
test("frontal → trasera → frontal y reinicio entregan sesiones distintas", async () => {
  const sessions = [], calls = [];
  const provider = devices(async (c) => { calls.push(c.video.facingMode.ideal); const stream = mockStream({ facingMode: c.video.facingMode.ideal }); sessions.push(stream); return stream; }, { facingMode: true });
  let previous = null;
  for (const facingMode of ["user", "environment", "user", "user"]) {
    stopStream(previous);
    previous = (await acquireCamera(provider, { mobile: true, facingMode })).stream;
  }
  assert.deepEqual(calls, ["user", "environment", "user", "user"]);
  assert.deepEqual(sessions.map((s) => s.state.stops), [1, 1, 1, 0]); stopStream(previous);
});
test("una adquisición que llega tarde se detiene y no ocupa la nueva sesión", async () => {
  let finish, current = true;
  const stream = mockStream();
  const pending = acquireCamera(devices(() => new Promise((resolve) => { finish = resolve; })), { mobile: true, isCurrent: () => current });
  current = false; finish(stream);
  await assert.rejects(pending, { name: "AbortError" }); assert.ok(stream.state.stops > 0);
});
test("sólo elimina crop y zoom con capacidades y configuración verificadas", async () => {
  const stream = mockStream({ resizeMode: "crop-and-scale", zoom: 3 }, { resizeMode: ["none", "crop-and-scale"], zoom: { min: 1, max: 5, step: .1 } });
  const { diagnostics } = await acquireCamera(devices(async () => stream, { resizeMode: true, zoom: true }), { mobile: true });
  assert.deepEqual(stream.state.adjustments, [{ resizeMode: { exact: "none" } }, { advanced: [{ zoom: 1 }] }]);
  assert.equal(diagnostics.browserReportsCrop, false); assert.equal(diagnostics.zoom.current, 1); assert.equal(diagnostics.adjustments[1].before.zoom, 3);
});
test("zoom desconocido, sin soporte, inválido o ya mínimo nunca se modifica", async () => {
  for (const [settings, capabilities, supported] of [[{}, { zoom: { min: 1, max: 5 } }, { zoom: true }],
    [{ zoom: 3 }, {}, { zoom: true }], [{ zoom: 3 }, { zoom: { min: 1, max: 5 } }, {}],
    [{ zoom: 1 }, { zoom: { min: 1, max: 5 } }, { zoom: true }], [{ zoom: 9 }, { zoom: { min: 1, max: 5 } }, { zoom: true }]]) {
    const stream = mockStream(settings, capabilities);
    await acquireCamera(devices(async () => stream, supported), { mobile: true }); assert.deepEqual(stream.state.adjustments, []);
  }
});
test("applyConstraints rechazado o ignorado queda visible sin afirmar corrección", async () => {
  for (const rejects of [true, false]) {
    const stream = mockStream({ zoom: 3, resizeMode: "crop-and-scale" }, { zoom: { min: 1, max: 5 }, resizeMode: ["none"] });
    stream.track.applyConstraints = async () => { if (rejects) throw failure("OverconstrainedError"); };
    const { diagnostics } = await acquireCamera(devices(async () => stream, { zoom: true, resizeMode: true }), { mobile: true });
    assert.equal(diagnostics.zoom.current, 3); assert.equal(diagnostics.browserReportsCrop, true);
    assert.equal(diagnostics.adjustments.length, 2);
    assert.equal(Boolean(diagnostics.adjustments[0].error), rejects);
  }
});
test("APIs opcionales de capacidades ausentes o que lanzan no bloquean la cámara", async () => {
  const stream = mockStream(); stream.track.getCapabilities = () => { throw new Error("unsupported"); };
  const { diagnostics } = await acquireCamera({ getUserMedia: async () => stream }, { mobile: true });
  assert.deepEqual(diagnostics.capabilities, {}); assert.deepEqual(diagnostics.supportedConstraints, {});
  delete stream.track.getCapabilities;
  assert.equal(cameraTrackSnapshot(stream).capabilitiesAvailable, false);
});

const modelNames = ["RB2140-901-50-v2.19", "Harley-Davidson_HD0896_001_V4_definitivo"];
const models = modelNames.map((name) => JSON.parse(readFileSync(new URL(`../../public/virtual-try-on/models/${name}.tryon.json`, import.meta.url))));
const sources = [[720, 1280], [1080, 1920], [1280, 720], [640, 480]];
for (const [width, height] of sources) test(`integración fuente ${width}×${height}: visor completo, proyección y escala física independientes del layout`, () => {
  const face = scaleFace();
  face.landmarks = face.landmarks.map((p) => ({ ...p, x: .5 + (p.x - .5) * 1000 / width, y: .5 + (p.y - .5) * 500 / height }));
  for (const model of models) {
    const approved = landmarksToGlassesPose(face.landmarks, width, height, model, face.transform);
    assert.ok(approved);
    for (const usefulWidth of [320, 374, 414, 760]) {
      const viewer = mobileViewerDimensions(width, height, usefulWidth), mapping = framePresentation(width, height, viewer.width, viewer.height);
      near(mapping.visibleFraction, 1); near(mapping.magnificationVsFullWidth, 1);
      near(mapping.visibleSource.x, 0); near(mapping.visibleSource.y, 0);
      near(mapping.visibleSource.width, width); near(mapping.visibleSource.height, height);
      near(mapping.media.width, viewer.width); near(mapping.media.height, viewer.height);
      const pose = landmarksToGlassesPose(face.landmarks, width, height, model, face.transform);
      assert.deepEqual(pose, approved); // No viewport is passed to physical geometry.
      for (const p of [[0, 0], [width / 2, height / 2], [width, height]]) {
        const world = unprojectVideoPoint(...p, 0, cameraProjection(width, height));
        const webglPixel = [world[0] + width / 2, height / 2 - world[1]];
        near(webglPixel[0] * mapping.cssPixelsPerSourcePixel, p[0] * mapping.cssPixelsPerSourcePixel);
        near(webglPixel[1] * mapping.cssPixelsPerSourcePixel, p[1] * mapping.cssPixelsPerSourcePixel);
      }
      const frameWidthCss = pose.scaleDiagnostics.correctedEstimatedFrameWidthPx * mapping.cssPixelsPerSourcePixel;
      near(frameWidthCss / (pose.scale * mapping.cssPixelsPerSourcePixel), model.dimensionsMm.frameWidth);
    }
  }
});
test("rotación, cambio, reinicio y resolución dinámica conservan la totalidad de la fuente", () => {
  const sequence = [...sources, [480, 640], [1920, 1080], [1080, 1920], [720, 1280], [720, 1280]];
  sequence.forEach(([width, height], i) => {
    const viewer = mobileViewerDimensions(width, height, i % 2 ? 760 : 374);
    const mapping = framePresentation(width, height, viewer.width, viewer.height);
    near(mapping.visibleFraction, 1); near(mapping.sourceAspect, mapping.viewerAspect);
  });
});
test("regresión de cover anterior: landscape en 374×490 muestra sólo 42.9% y magnifica 2.33×", () => {
  const before = framePresentation(1280, 720, 374, 490);
  near(before.visibleFraction, .42933673469387756); near(before.magnificationVsFullWidth, 2.329174093880);
  assert.equal(before.fullFrameVisible, false);
});
test("diagnóstico con dimensiones todavía desconocidas no inventa ROI", () => assert.equal(framePresentation(0, 0, 374, 490), null));
for (const [width, height] of sources) for (const mirrored of [true, false]) test(`captura ${width}×${height}, espejo=${mirrored}: fuente y Canvas completos`, () => {
  const ops = [], context = Object.fromEntries(["save", "translate", "scale", "drawImage", "restore"].map((name) => [name, (...args) => ops.push([name, ...args])]));
  drawTryOnCapture(context, "source", "canvas", width, height, mirrored);
  assert.deepEqual(ops, [...(mirrored ? [["save"], ["translate", width, 0], ["scale", -1, 1]] : []),
    ["drawImage", "source", 0, 0, width, height], ...(mirrored ? [["restore"]] : []), ["drawImage", "canvas", 0, 0, width, height]]);
});
test("errores, ausencia de rostro y rechazo de pose son categorías separadas", () => {
  const c = createDetectionDiagnostics();
  recordDetectionResult(c, { result: { faceLandmarks: [] } });
  recordDetectionResult(c, { inferenceError: new Error("worker") });
  recordDetectionResult(c, { result: { faceLandmarks: [[{}]] }, pose: {} });
  recordDetectionResult(c, { result: { faceLandmarks: [[{}]] } });
  recordDetectionResult(c, { result: { faceLandmarks: [[{}]] }, poseError: new Error("geometry") });
  assert.equal(c.inferencesCompleted, 4); assert.equal(c.inferencesWithoutFace, 1); assert.equal(c.inferencesWithFace, 3);
  assert.equal(c.mediaPipeErrors, 1); assert.equal(c.poseConversionRejections, 2); assert.equal(c.poseConversionErrors, 1);
});
test("identidad de build congela el commit de Vercel en vez del checkout local", () => {
  const identity = vtoBuildInfo(process.cwd(), { VERCEL_GIT_COMMIT_SHA: "abc123", VERCEL_GIT_COMMIT_REF: "provadorv2-mobile-camera", VERCEL_URL: "preview.vercel.app" });
  assert.equal(identity.commit, "abc123"); assert.equal(identity.branch, "provadorv2-mobile-camera");
  assert.equal(identity.dirty, false); assert.equal(identity.deployment, "preview.vercel.app"); assert.ok(Date.parse(identity.builtAt));
});
const fingerprints = JSON.parse(readFileSync(new URL("../fixtures/notebook-approved-fingerprints.json", import.meta.url)));
for (const [path, hash] of Object.entries(fingerprints.sha256)) test(`notebook aprobado: fingerprint ${path}`, () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex"), hash);
});
test("notebook aprobado: todas las reglas CSS desktop anteriores al breakpoint móvil permanecen idénticas", () => {
  const css = readFileSync(new URL("../../src/app/virtual-try-on/3d/virtual-try-on-3d.module.css", import.meta.url), "utf8")
    .replaceAll("\r\n", "\n").split("@media (max-width: 780px)")[0];
  assert.equal(createHash("sha256").update(css).digest("hex"), fingerprints.desktopCssPrefixSha256);
});
