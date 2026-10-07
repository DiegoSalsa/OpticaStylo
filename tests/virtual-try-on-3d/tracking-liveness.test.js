import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PoseFilter, MIN_TRACKING_GRACE_MS, MAX_TRACKING_GRACE_MS } from "../../src/virtual-try-on-3d/pose-filter.js";
import { TrackingTimeline } from "../../src/virtual-try-on-3d/tracking-timeline.js";
import { desktopTrajectoryDigest, simulateTracking, trackingMeasurement } from "../fixtures/tracking-simulation.js";

for (const delayMs of [220, 300]) for (const backend of ["worker", "main-thread"]) {
  test(`${backend}: SDK ${delayMs} ms durante 6s, sin ocultaciones entre resultados válidos`, () => {
    const simulation = simulateTracking(PoseFilter, { delayMs, backend });
    assert.equal(simulation.firstValidReceipt, delayMs);
    assert.ok(simulation.inferenceCount >= 15);
    assert.ok(simulation.visibleFrames > 40);
    assert.equal(simulation.hiddenAfterFirst, 0);
    assert.equal(simulation.metrics.visibilityTimeoutCount, 0);
    assert.equal(simulation.metrics.poseAcceptedCount, simulation.inferenceCount);
    assert.ok(simulation.metrics.currentGraceMs <= MAX_TRACKING_GRACE_MS);
    if (backend === "worker") assert.ok(simulation.renderedFrames >= 360);
  });
}

for (const backend of ["worker", "main-thread"]) test(`${backend}: alternar inferencias 20/220/300ms conserva continuidad`, () => {
  const simulation = simulateTracking(PoseFilter, { delayMs: (i) => [20, 220, 300, 30][i % 4], backend });
  assert.equal(simulation.hiddenAfterFirst, 0);
});

test("una medición de 220ms llega visible y tiene dos edades diferentes", () => {
  const f = new PoseFilter();
  assert.equal(f.update(trackingMeasurement(), 0, 220), true);
  assert.ok(f.sample(220));
  const m = f.metrics(220);
  assert.equal(m.measurementAgeMs, 220); assert.equal(m.timeSinceLastValidResultMs, 0);
  assert.equal(m.lastValidMeasurementTimestamp, 0); assert.equal(m.lastValidReceivedTimestamp, 220);
  assert.equal(m.predictionEnabled, false);
});

for (const misses of [1, 2]) test(`${misses} misses breves a 4Hz no ocultan ni reinician filtros`, () => {
  const f = new PoseFilter();
  f.update(trackingMeasurement(0), 0, 220); f.update(trackingMeasurement(1), 250, 470);
  const positionFilter = f.position[0], scaleFilter = f.scale;
  const velocity = [...f.velocity], q = f.q.toArray(), scale = f.scale.value;
  const bends = f.temples.map((t) => t.value);
  let receipt = 470;
  for (let i = 0; i < misses; i++) {
    const next = receipt + 250;
    for (let now = receipt; now < next; now += 1000 / 60) assert.ok(f.sample(now));
    receipt = next; f.update(null, receipt - 220, receipt);
    assert.ok(f.sample(receipt)); assert.equal(f.metrics(receipt).trackingState, "TRACKING_GRACE");
    assert.equal(f.metrics(receipt).predictionEnabled, false);
  }
  assert.deepEqual(f.velocity, velocity); assert.deepEqual(f.q.toArray(), q);
  assert.equal(f.scale.value, scale); assert.deepEqual(f.temples.map((t) => t.value), bends);
  for (let now = receipt; now < receipt + 250; now += 1000 / 60) assert.ok(f.sample(now));
  f.update(trackingMeasurement(2), receipt + 30, receipt + 250);
  assert.equal(f.position[0], positionFilter); assert.equal(f.scale, scaleFilter);
  assert.ok(f.sample(receipt + 250));
  assert.equal(f.temporaryMissCount, misses); assert.equal(f.visibilityTimeoutCount, 0);
  assert.equal(f.trackingState, "TRACKING");
});

test("pérdida real oculta dentro del máximo y cuenta el timeout una sola vez", () => {
  const f = new PoseFilter(); f.update(trackingMeasurement(), 0, 220);
  f.setExpectedDeliveryInterval(300);
  assert.equal(f.currentGraceMs, 800); assert.ok(f.sample(1020));
  assert.equal(f.sample(1021), null); assert.equal(f.sample(3000), null);
  assert.equal(f.visibilityTimeoutCount, 1); assert.equal(f.trackingState, "LOST");
  assert.deepEqual(f.velocity, [0, 0, 0]); assert.equal(f.angularSpeed, 0);
});

test("pérdida sostenida con resultados sin rostro no prolonga la última detección", () => {
  const f = new PoseFilter(); f.update(trackingMeasurement(), 0, 20);
  for (let t = 50; t <= 200; t += 50) f.update(null, t - 20, t);
  assert.equal(f.sample(201), null);
  assert.equal(f.metrics(201).lastValidReceivedTimestamp, 20);
  assert.equal(f.metrics(201).receivedTimestamp, 200);
});

test("reaparición tras pérdida confirmada aplica la nueva pose sin velocidad residual", () => {
  const f = new PoseFilter(); f.update(trackingMeasurement(0), 0, 20); f.update(trackingMeasurement(8), 33, 53);
  assert.equal(f.sample(234), null);
  const newPose = trackingMeasurement(30); newPose.position = [-100, 60, 0];
  f.update(newPose, 1000, 1020);
  const out = f.sample(1020);
  assert.deepEqual(out.position, newPose.position); assert.equal(out.scale, newPose.scale);
  assert.deepEqual(f.velocity, [0, 0, 0]); assert.equal(f.angularSpeed, 0);
  assert.equal(f.trackingState, "TRACKING");
});

test("dt y velocidad usan captura, sin reset por mediciones separadas 300ms", () => {
  const f = new PoseFilter(), a = trackingMeasurement(), b = trackingMeasurement();
  a.position = [0, 0, 0]; b.position = [90, 0, 0];
  f.update(a, 0, 220); const savedFilter = f.position[0];
  f.update(b, 300, 520);
  assert.equal(f.position[0], savedFilter);
  assert.equal(f.velocity[0], 300); assert.ok(f.sample(520).position[0] > 89);
});

test("mediciones retrasadas no extrapolan 220ms ni durante la gracia", () => {
  const f = new PoseFilter(), a = trackingMeasurement(), b = trackingMeasurement();
  a.position = [0, 0, 0]; b.position = [100, 0, 0];
  f.update(a, 0, 220); f.update(b, 100, 320);
  const filtered = f.position[0].value;
  assert.equal(f.sample(320).position[0], filtered); assert.equal(f.sample(400).position[0], filtered);
  assert.equal(f.metrics(400).predictionEnabled, false);
});

test("una pose nueva válida se aplica al instante durante la gracia", () => {
  const f = new PoseFilter(); f.update(trackingMeasurement(), 0, 220); f.update(null, 250, 470);
  const next = trackingMeasurement(); next.position = [80, 0, 0];
  f.update(next, 500, 720);
  assert.ok(f.sample(720).position[0] > 79);
  assert.equal(f.lastValidReceivedTimestamp, 720); assert.equal(f.trackingState, "TRACKING");
});

test("timestamps viejos, futuros o de recepción desordenada no renuevan liveness", () => {
  const f = new PoseFilter(); f.update(trackingMeasurement(), 10, 100);
  assert.equal(f.update(trackingMeasurement(), 10, 200), false);
  assert.equal(f.update(trackingMeasurement(), 20, 99), false);
  assert.equal(f.update(trackingMeasurement(), 300, 200), false);
  assert.equal(f.lastValidReceivedTimestamp, 100);
  assert.equal(f.poseRejectedCount, 3); assert.equal(f.metrics(200).poseFilterRejectReason, "invalid-timestamps");
});

test("cadencia adaptativa conserva 180ms en escritorio y limita stalls a 800ms", () => {
  const f = new PoseFilter(); f.update(trackingMeasurement(), 0, 20);
  f.setExpectedDeliveryInterval(33); assert.equal(f.currentGraceMs, MIN_TRACKING_GRACE_MS);
  f.setExpectedDeliveryInterval(264); assert.equal(f.currentGraceMs, 792);
  f.setExpectedDeliveryInterval(10000); assert.equal(f.currentGraceMs, MAX_TRACKING_GRACE_MS);
});

test("timeline mide entregas y observa SDK pendiente sin cambiar la cadencia de adquisición", () => {
  const t = new TrackingTimeline(); t.begin(0); t.finish(0, 220, 220);
  assert.ok(Math.abs(t.expectedDeliveryInterval(220) - 253) < 1e-9);
  t.begin(264); t.finish(264, 220, 484);
  assert.equal(t.lastDeliveryIntervalMs, 264);
  const approvedInterval = t.intervalMs;
  t.begin(528); assert.ok(t.expectedDeliveryInterval(800) >= 272 * 1.15);
  assert.equal(t.intervalMs, approvedInterval); assert.equal(t.begin(800), false);
});

const desktopBaseline = JSON.parse(readFileSync(new URL("../fixtures/tracking-desktop-baseline.json", import.meta.url)));
for (const delayMs of [15, 20, 30]) test(`desktop ${delayMs}ms: trayectoria idéntica al filtro aprobado en 9b6af11`, () => {
  assert.equal(desktopTrajectoryDigest(PoseFilter, delayMs), desktopBaseline.digests[delayMs]);
});
