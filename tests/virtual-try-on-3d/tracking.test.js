import assert from "node:assert/strict";
import test from "node:test";
import { Quaternion, Vector3 } from "three";
import { PoseFilter } from "../../src/virtual-try-on-3d/pose-filter.js";
import { TrackingTimeline, startVideoFrameLoop } from "../../src/virtual-try-on-3d/tracking-timeline.js";

const measurement = (x, yaw = 0) => ({ position: [x, 0, 0], scale: 3,
  quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).toArray(),
  faceMesh: { positions: new Float32Array(1404), local: true }, headRotation: [0, yaw, 0],
  templeFit: { left: { bendRadians: 0.1 }, right: { bendRadians: 0.05 } } });

test("descarta timestamps antiguos/duplicados y no aplica resultados fuera de orden", () => {
  const filter = new PoseFilter(); filter.update(measurement(10), 100);
  assert.equal(filter.update(measurement(400), 99), false); assert.equal(filter.update(measurement(400), 100), false);
  assert.equal(filter.sample(100).position[0], 10);
});
test("una sola inferencia en vuelo; frames posteriores se descartan sin cola", () => {
  const timeline = new TrackingTimeline(); assert.equal(timeline.observe(0), true);
  assert.equal(timeline.begin(0), true); assert.equal(timeline.begin(16), false);
  assert.equal(timeline.finish(-10, 30), false); assert.equal(timeline.inFlight, true);
  assert.equal(timeline.finish(0, 30), true);
  assert.equal(timeline.observe(0), false); assert.equal(timeline.observe(-1), false);
  assert.equal(timeline.begin(40), true); assert.equal(timeline.finish(0, 40), false);
  assert.equal(timeline.finish(40, 8), true);
});
test("inferencia lenta adapta cadencia y luego recupera FPS", () => {
  const timeline = new TrackingTimeline(); timeline.begin(0); timeline.finish(0, 60);
  assert.equal(timeline.begin(16), false); assert.ok(timeline.intervalMs >= 60);
  let now = 100;
  for (let i = 0; i < 20; i++) { timeline.begin(now); timeline.finish(now, 5); now += 100; }
  assert.ok(timeline.intervalMs < 8);
});
for (const fps of [15, 30, 60]) {
  for (const speed of [30, 700]) test(`tracking ${fps} FPS, movimiento ${speed} px/s`, () => {
    const filter = new PoseFilter(), dt = 1000 / fps;
    for (let i = 0; i <= fps; i++) filter.update(measurement(speed * i / fps, i / fps * 0.6), i * dt);
    const rendered = filter.sample(1000);
    assert.ok(Math.abs(rendered.position[0] - speed) < (speed > 100 ? 3 : 1.5));
    assert.ok(Math.abs(Math.hypot(...rendered.quaternion) - 1) < 1e-6);
  });
}
test("ruido subpixel de reposo se atenúa sin dead zone acumulativa", () => {
  const filter = new PoseFilter(), values = [];
  for (let i = 0; i < 300; i++) {
    const noise = i % 2 ? 0.3 : -0.3; filter.update(measurement(noise), i * 1000 / 60);
    if (i > 60) values.push(filter.sample(i * 1000 / 60 + 16).position[0]);
  }
  const rms = Math.sqrt(values.reduce((s, x) => s + x * x, 0) / values.length);
  assert.ok(rms < 0.12, `RMS ${rms}`);
});
test("parada brusca cancela predicción lineal/angular y converge sin rebote", () => {
  const filter = new PoseFilter();
  filter.update(measurement(0, 0), 0); filter.update(measurement(40, 0.2), 33);
  assert.ok(filter.sample(50).position[0] > 40);
  filter.update(measurement(40, 0.2), 66);
  assert.ok(filter.sample(83).position[0] <= 40);
  const atStop = filter.sample(66).position[0];
  for (let i = 3; i < 10; i++) { filter.update(measurement(40, 0.2), 33 * i); assert.ok(filter.sample(33 * i).position[0] <= 40); }
  assert.ok(filter.sample(297).position[0] >= atStop);
});
test("ruido angular pequeño no genera predicción al refrescar entre mediciones", () => {
  const filter = new PoseFilter(); filter.update(measurement(0, -0.002), 0); filter.update(measurement(0, 0.002), 33);
  const measured = new Quaternion().fromArray(filter.sample(33).quaternion);
  const display = new Quaternion().fromArray(filter.sample(50).quaternion);
  assert.ok(measured.angleTo(display) < 1e-6); assert.equal(filter.angularSpeed, 0);
});
test("predicción acotada, pérdida oculta y recuperación reinicia velocidad", () => {
  const filter = new PoseFilter(); filter.update(measurement(0), 0); filter.update(measurement(100), 33);
  assert.ok(filter.sample(58).position[0] <= 112);
  filter.update(null, 66); assert.equal(filter.metrics(66).facialSpeedPxPerSecond, 0);
  assert.equal(filter.sample(214), null);
  filter.update(measurement(-80), 250); assert.equal(filter.sample(250).position[0], -80);
});
test("escala se estabiliza separado de traslación y cada patilla conserva clearance", () => {
  const filter = new PoseFilter(); filter.update(measurement(0), 0);
  const next = measurement(60); next.scale = 3.03; next.templeFit.left.bendRadians = 0.3;
  filter.update(next, 33); const rendered = filter.sample(33);
  assert.ok(rendered.position[0] > 58); assert.ok(rendered.scale < 3.02);
  assert.equal(rendered.templeBends[0], 0.3); assert.equal(rendered.templeBends[1], 0.05);
});
test("RVFC se cancela; fallback RAF identifica video.currentTime sin duplicar inferencia", () => {
  let callback, canceled;
  const video = { readyState: 2, currentTime: 1, requestVideoFrameCallback(cb) { callback = cb; return 7; }, cancelVideoFrameCallback(id) { canceled = id; } };
  const values = [], stop = startVideoFrameLoop(video, (...args) => values.push(args));
  callback(10, { mediaTime: 0.3, captureTime: 8 }); stop(); assert.equal(canceled, 7); assert.deepEqual(values[0], [10, 0.3, 8]);
  delete video.requestVideoFrameCallback;
  const timeline = new TrackingTimeline(); let inferences = 0;
  const stopFallback = startVideoFrameLoop(video, (_, time) => { if (timeline.observe(time)) inferences++; }, { requestAnimationFrame(cb) { callback = cb; return 8; }, cancelAnimationFrame(id) { canceled = id; } });
  callback(20); callback(36); assert.equal(inferences, 1); video.currentTime = 2; callback(52); assert.equal(inferences, 2); stopFallback(); assert.equal(canceled, 8);
});
