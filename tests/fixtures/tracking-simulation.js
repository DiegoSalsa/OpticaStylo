import { createHash } from "node:crypto";
import { Euler, Quaternion } from "three";
import { TrackingTimeline } from "../../src/virtual-try-on-3d/tracking-timeline.js";

export function trackingMeasurement(index = 0) {
  return { position: [48 * Math.sin(index / 9), 12 * Math.cos(index / 7), 0],
    quaternion: new Quaternion().setFromEuler(new Euler(0.08 * Math.sin(index / 11), 0.3 * Math.sin(index / 8), 0)).toArray(),
    scale: 3 + 0.02 * Math.sin(index / 5),
    faceMesh: { positions: new Float32Array(1404), local: true },
    templeFit: { left: { bendRadians: 0.1 + 0.025 * Math.cos(index / 6) }, right: { bendRadians: 0.08 } } };
}

// Independent capture/delivery/render clocks. The SDK's simulated duration does
// not sleep in the test runner; the scheduler still sees every 33ms video frame.
export function simulateTracking(FilterClass, { delayMs, durationMs = 6000, backend = "worker", misses = [] } = {}) {
  const timeline = new TrackingTimeline(), filter = new FilterClass(), receipts = [];
  let pending = null, nextRender = 0, firstValidReceipt = null;
  let visibleFrames = 0, hiddenAfterFirst = 0, renderedFrames = 0;
  for (let now = 0; now <= durationMs; now++) {
    if (pending && now >= pending.readyAt) {
      timeline.finish(pending.sampledAt, pending.delay, now);
      const pose = misses.includes(timeline.inferences) ? null : trackingMeasurement(pending.sampledAt / 33);
      filter.update(pose, pending.sampledAt, now, timeline.expectedDeliveryInterval(now));
      if (pose && firstValidReceipt === null) firstValidReceipt = now;
      receipts.push(now); pending = null;
    }
    if (now % 33 === 0 && timeline.observe(now / 1000) && timeline.begin(now)) {
      const delay = typeof delayMs === "function" ? delayMs(timeline.inferences) : delayMs;
      pending = { sampledAt: now, readyAt: now + delay, delay };
    }
    if (now >= nextRender) {
      nextRender += 1000 / 60;
      if (backend === "main-thread" && pending) continue; // RAF is blocked during the synchronous SDK call.
      filter.setExpectedDeliveryInterval?.(timeline.expectedDeliveryInterval(now));
      const visible = Boolean(filter.sample(now)); renderedFrames++;
      if (firstValidReceipt !== null) {
        if (visible) visibleFrames++; else hiddenAfterFirst++;
      }
    }
  }
  return { backend, durationMs, firstValidReceipt, visibleFrames, hiddenAfterFirst, renderedFrames,
    inferenceCount: timeline.inferences, deliveryIntervalsMs: receipts.slice(1).map((r, i) => r - receipts[i]),
    metrics: filter.metrics(durationMs) };
}

// Fingerprint the approved fast-device motion, not its diagnostic fields or
// visibility timeout after a loss. Values rounded at 1e-10 tolerate platform math.
export function desktopTrajectoryDigest(FilterClass, delayMs) {
  const filter = new FilterClass(), outputs = [];
  let nextMeasurement = 0;
  const rounded = (values) => values.map((v) => Number(v.toFixed(10)));
  for (let render = 0; render <= 180; render++) {
    const now = render * 1000 / 60;
    while (nextMeasurement * 33 + delayMs <= now) {
      const timestamp = nextMeasurement * 33;
      filter.update(trackingMeasurement(nextMeasurement), timestamp, timestamp + delayMs);
      nextMeasurement++;
    }
    const pose = filter.sample(now);
    outputs.push(pose ? { position: rounded(pose.position), quaternion: rounded(pose.quaternion),
      scale: Number(pose.scale.toFixed(10)), temples: rounded(pose.templeBends) } : null);
  }
  return createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
}
