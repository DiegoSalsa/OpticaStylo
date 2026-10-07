import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TrackingSurface, trackingSize } from "../../src/virtual-try-on-3d/tracking-surface.js";
import { TrackingPerformance } from "../../src/virtual-try-on-3d/tracking-performance.js";
import { cameraCaptureConstraints } from "../../src/virtual-try-on-3d/camera-capture.js";
import { PoseFilter } from "../../src/virtual-try-on-3d/pose-filter.js";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { rebuildFace } from "../fixtures/rebuild-face.js";

const metadata = JSON.parse(readFileSync(new URL("../../public/virtual-try-on/models/RB2140-901-50-v2.19.tryon.json", import.meta.url)));
test("superficie única, sin crop/espejo, dimensiones originales separadas", () => {
  const draws = [], canvas = { width: 1, height: 1, getContext: () => ({ drawImage: (...args) => draws.push(args) }) };
  let allocations = 0;
  const surface = new TrackingSurface(() => { allocations++; return canvas; }), source = { videoWidth: 720, videoHeight: 1280 };
  for (const dim of [640, 480, 360, 640]) {
    const frame = surface.prepare(source, dim), size = trackingSize(720, 1280, dim);
    assert.equal(frame.input, canvas); assert.equal(frame.sourceWidth, 720); assert.equal(frame.sourceHeight, 1280);
    assert.equal(Math.max(frame.trackingWidth, frame.trackingHeight), dim);
    assert.deepEqual(draws.at(-1), [source, 0, 0, size.width, size.height]);
  }
  assert.equal(allocations, 1); assert.equal(surface.prepare(source).input, source);
  surface.close(); assert.equal(canvas.width, 1);
});
test("worker y main: landmarks de 640/480/360 reconstruyen la MISMA pose en fuente 720×1280", async () => {
  const original = { Worker: globalThis.Worker, OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap };
  const f = rebuildFace(720, 1280, { yaw: 0.4, pitch: 0.1 });
  const sdkResult = () => ({ faceLandmarks: [f.landmarks], facialTransformationMatrixes: [f.transform], inferenceDurationMs: 12 });
  let resolveFrame, sdkSizes = [], bitmapClosed = 0;
  class FakeCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return { drawImage() {} }; }
  }
  class FakeWorker {
    postMessage(message) {
      if (message.type === "init") queueMicrotask(() => this.onmessage({ data: { faceMeshTriangleIndices: [0, 1, 2] } }));
      else {
        sdkSizes.push([message.bitmap.width, message.bitmap.height]);
        // Real transfer detaches the bitmap. Dimensions must be captured before.
        message.bitmap.width = message.bitmap.height = 0;
        resolveFrame = () => { bitmapClosed++; this.onmessage({ data: { timestamp: message.timestamp, result: sdkResult() } }); };
        queueMicrotask(resolveFrame);
      }
    }
    terminate() {}
  }
  try {
    globalThis.Worker = FakeWorker; globalThis.OffscreenCanvas = FakeCanvas;
    globalThis.createImageBitmap = async (image) => ({ width: image.width || image.videoWidth * 2, height: image.height || image.videoHeight * 2, close() { bitmapClosed++; } });
    globalThis.__vtoTestCore = async () => ({ landmarker: {
      detectForVideo(input) { sdkSizes.push([input.width, input.height]); return sdkResult(); }, close() {},
    } });
    const source = readFileSync(new URL("../../src/app/virtual-try-on/3d/face-tracking.js", import.meta.url), "utf8")
      .replace('import { createFaceTrackingOnThread } from "./face-tracking-core.js";', 'const createFaceTrackingOnThread = globalThis.__vtoTestCore;')
      .replace('"@/virtual-try-on-3d/tracking-surface"', JSON.stringify(new URL("../../src/virtual-try-on-3d/tracking-surface.js", import.meta.url).href))
      .replace('new URL("./face-tracking.worker.js", import.meta.url)', 'new URL("file:///tracking.worker.js")');
    const { createFaceTracking } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const expected = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
    for (const preferWorker of [true, false]) {
      const session = await createFaceTracking("VIDEO", { preferWorker }); sdkSizes = [];
      for (const dim of [640, 480, 360]) {
        const pending = session.landmarker.detectForVideo({ videoWidth: 720, videoHeight: 1280 }, performance.now(), { maxDimension: dim });
        if (preferWorker && dim === 640) await assert.rejects(session.landmarker.detectForVideo({ videoWidth: 720, videoHeight: 1280 }, performance.now()), /unavailable/);
        const result = await pending;
        assert.equal(result.sourceWidth, 720); assert.equal(result.sourceHeight, 1280);
        assert.equal(result.trackingHeight, dim); assert.equal(result.trackingWidth, Math.round(dim * 720 / 1280));
        const actual = landmarksToGlassesPose(result.faceLandmarks[0], result.sourceWidth, result.sourceHeight, metadata, result.facialTransformationMatrixes[0]);
        assert.deepEqual(actual, expected);
      }
      assert.deepEqual(sdkSizes, [[360, 640], [270, 480], [202.5, 360]].map(([w,h]) => [Math.round(w),h]));
      if (preferWorker) {
        const native = await session.landmarker.detectForVideo({ videoWidth: 720, videoHeight: 1280 }, performance.now());
        assert.equal(native.trackingWidth,720); assert.equal(native.trackingHeight,1280);
        assert.deepEqual(sdkSizes.at(-1),[720,1280]);
      }
      session.landmarker.close();
      await assert.rejects(async () => session.landmarker.detectForVideo({ videoWidth: 720, videoHeight: 1280 }, performance.now()), /closed|unavailable/);
    }
    assert.equal(bitmapClosed, 5);
  } finally {
    for (const [key, value] of Object.entries(original)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    delete globalThis.__vtoTestCore;
  }
});
test("captura compacta 30 FPS sin resizeMode, desktop aprobado 1280×720 a 60", () => {
  const compact = cameraCaptureConstraints(true), desktop = cameraCaptureConstraints(false);
  assert.equal(compact.video.frameRate.ideal, 30); assert.equal("resizeMode" in compact.video, false);
  assert.deepEqual(desktop.video, { facingMode: { ideal: "user" }, aspectRatio: { ideal: 16/9 }, height: { ideal: 720 }, width: { ideal: 1280 }, frameRate: { ideal: 60, max: 60 } });
});
test("coste persistente reduce 640→480→360 con hysteresis y recuperación lenta", () => {
  const p = new TrackingPerformance(true), transitions = [];
  for (let i = 0; i < 200; i++) {
    const before = p.maxDimension;
    p.record({ inferenceDurationMs: 80 }, i * 120, 85, 60);
    if (before !== p.maxDimension) transitions.push([i * 120, p.maxDimension]);
  }
  assert.deepEqual(transitions.map((t) => t[1]), [480, 360]);
  assert.ok(transitions[1][0] - transitions[0][0] >= 3000);
  assert.equal(p.metrics().performanceBudget, "exceeded");
  const started = 24000;
  for (let i = 1; i <= 70; i++) p.record({ inferenceDurationMs: 12 }, started + i * 50, 15, 60);
  assert.equal(p.maxDimension, 360); // Cannot restore after just a few good samples.
  for (let i = 71; i <= 230; i++) p.record({ inferenceDurationMs: 12 }, started + i * 50, 15, 60);
  assert.equal(p.maxDimension, 480); assert.equal(p.changes, 3);
});
test("desktop: medidas no cambian resolución/cadencia; filtro no oculta lag con grace nuevo", () => {
  const p = new TrackingPerformance(false);
  for (let i = 0; i < 200; i++) p.record({ inferenceDurationMs: 250 }, i * 300, 260, 40);
  assert.equal(p.maxDimension, Infinity); assert.equal(p.minIntervalMs, 0); assert.equal(p.changes, 0);
  const f = rebuildFace(720, 1280), pose = landmarksToGlassesPose(f.landmarks, 720, 1280, metadata, f.transform);
  const filter = new PoseFilter(); filter.update(pose, 0); filter.update(null, 33); filter.update(null, 66);
  assert.ok(filter.sample(100)); assert.equal(filter.sample(181), null);
  filter.update(pose, 300); assert.equal(filter.sample(490), null); // 190 ms delivery is already stale.
});
