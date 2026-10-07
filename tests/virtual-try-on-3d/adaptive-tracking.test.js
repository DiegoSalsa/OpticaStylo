import assert from "node:assert/strict";
import test from "node:test";
import { AdaptiveTrackingQuality, SampleWindow, trackingPerformanceBudget } from "../../src/virtual-try-on-3d/tracking-quality.js";
import { TrackingFrameSource, trackingDimensions } from "../../src/virtual-try-on-3d/frame-source.js";
import { TrackingDiagnostics } from "../../src/virtual-try-on-3d/tracking-diagnostics.js";
import { simulateMobilePipeline } from "../fixtures/mobile-pipeline.js";

test("downscale conserva aspect sin crop, reuse canvas y entrada native sin copias", () => {
  let surfaces = 0, draws = 0, lastArguments;
  const source = new TrackingFrameSource((width, height) => {
    surfaces++; return { width, height, getContext: () => ({ drawImage(...args) { draws++; lastArguments = args; } }) };
  });
  const video = { videoWidth: 1920, videoHeight: 1080 };
  assert.equal(source.prepare(video).input, video); assert.equal(surfaces, 0);
  const originalSurface = source.prepare(video, Infinity, true);
  assert.equal(originalSurface.trackingWidth, 1920); assert.equal(originalSurface.trackingHeight, 1080);
  const first = source.prepare(video, 640);
  assert.equal(first.trackingWidth, 640); assert.equal(first.trackingHeight, 360);
  for (let i = 0; i < 100; i++) assert.equal(source.prepare(video, 480).input, first.input);
  assert.equal(surfaces, 1); assert.equal(draws, 102);
  assert.deepEqual(lastArguments, [video, 0, 0, 1920, 1080, 0, 0, 480, 270]);
  video.videoWidth = 720; video.videoHeight = 1280;
  const rotated = source.prepare(video, 640); assert.equal(rotated.input, first.input);
  assert.equal(rotated.trackingWidth, 360); assert.equal(rotated.trackingHeight, 640);
  source.close(); assert.equal(first.input.width, 1);
});

for (const [w, h] of [[1920, 1080], [1280, 720], [720, 1280], [480, 853], [360, 640]]) {
  for (const max of [640, 480, 360]) test(`${w}x${h} -> ${max}: dimensiones sin upsample ni distorsión relevante`, () => {
    const size = trackingDimensions(w, h, max);
    assert.ok(Math.max(size.width, size.height) <= max);
    assert.ok(size.width <= w && size.height <= h);
    assert.ok(Math.abs((size.width / size.height) / (w / h) - 1) < 0.003);
  });
}

test("desktop rápido mantiene entrada y gate native, independientemente del backend", () => {
  for (const backend of ["worker", "main-thread"]) {
    const q = new AdaptiveTrackingQuality({ backend });
    for (let i = 0; i < 1000; i++) q.observe({ sdkMs: 20, deliveryMs: 33, now: i * 33 });
    assert.equal(q.profile.maxDimension, Infinity); assert.equal(q.minimumIntervalMs, 0); assert.equal(q.changes, 0);
  }
});

test("capacidad/backend define arranque y un outlier no cambia perfil", () => {
  const worker = new AdaptiveTrackingQuality({ compact: true }), main = new AdaptiveTrackingQuality({ compact: true, backend: "main-thread" });
  assert.equal(worker.profile.maxDimension, 640); assert.equal(main.profile.maxDimension, 480);
  for (let i = 0; i < 16; i++) worker.observe({ sdkMs: i === 1 ? 250 : 20, deliveryMs: 33, now: i * 33 });
  assert.equal(worker.profile.maxDimension, 640);
});

test("coste sostenido baja perfiles y recuperación exige headroom y cooldown", () => {
  const q = new AdaptiveTrackingQuality({ compact: true });
  for (let i = 1; i <= 80; i++) q.observe({ sdkMs: 120, deliveryMs: 132, now: i * 132 });
  assert.equal(q.profile.maxDimension, 360); assert.equal(q.changes, 2); assert.equal(q.budgetExceeded, true);
  const last = q.lastChangeAt;
  for (let i = 1; i <= 48; i++) q.observe({ sdkMs: 12, deliveryMs: 33, now: last + i * 33 });
  assert.equal(q.profile.maxDimension, 360);
  let receipt = last + 48 * 33;
  for (let i = 49; i <= 700; i++) {
    const deliveryMs = q.profile.maxDimension < 640 ? 66 : 33;
    receipt += deliveryMs; q.observe({ sdkMs: 12, deliveryMs, now: receipt });
  }
  assert.equal(q.profile.maxDimension, 640); assert.equal(q.profile.name, "640");
});

test("p50/p95 usa ventana acotada y diagnóstico separa preparación/SDK/entrega", () => {
  const window = new SampleWindow(4);
  for (const n of [1000, 10, 20, 30, 40]) window.add(n);
  assert.equal(window.percentile(0.5), 20); assert.equal(window.percentile(0.95), 40);
  const d = new TrackingDiagnostics();
  for (let i = 0; i < 32; i++) {
    d.recordInference({ faceLandmarks: [], trackingWidth: 360, trackingHeight: 640, preprocessingMs: 3 }, null, 20);
    d.recordDelivery(i * 33);
  }
  assert.equal(d.values.inferenceP50Ms, 20); assert.equal(d.values.inferenceP95Ms, 20);
  assert.equal(d.values.deliveryP50Ms, 33); assert.equal(d.values.deliveryP95Ms, 33);
  assert.equal(d.values.recentInferenceFps, 1000 / 33);
  assert.equal(d.values.preprocessingMs, 3); assert.equal(d.values.trackingWidth, 360);
});

test("presupuesto diferencia warmup, bueno, aceptable y rendimiento insuficiente", () => {
  assert.equal(trackingPerformanceBudget(null, 20, 50), "warming-up");
  assert.equal(trackingPerformanceBudget(60, 25, 80), "good");
  assert.equal(trackingPerformanceBudget(46, 13, 120), "acceptable");
  assert.equal(trackingPerformanceBudget(30, 30, 30), "exceeded");
  assert.equal(trackingPerformanceBudget(60, 4, 250), "exceeded");
});

for (const cost of [25, 50, 80, 120, 180, 250]) for (const backend of ["worker", "main-thread"]) {
  test(`${backend}, coste base ${cost}ms: adaptar sin backlog, cambio físico ni parpadeo`, () => {
    const result = simulateMobilePipeline(cost, { backend });
    assert.equal(result.hidden, 0); assert.equal(result.scaleError, 0);
    assert.ok(result.finalMaxHoldMs < 150);
    if (cost >= 120) assert.equal(result.finalProfile, "360");
    if (cost === 25 && backend === "worker") assert.equal(result.finalProfile, "640");
    assert.ok(result.finalSdkP95Ms <= cost);
  });
}

test("coste fijo 250ms: no inventar mejora o 60FPS en fallback bloqueado", () => {
  const result = simulateMobilePipeline(250, { fixedCost: true, backend: "main-thread" });
  assert.equal(result.finalProfile, "360"); assert.equal(result.finalSdkP95Ms, 250);
  assert.equal(result.budgetExceeded, true); assert.ok(result.frames < 1200);
  assert.equal(result.hidden, 0);
});
