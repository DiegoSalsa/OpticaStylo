import { AdaptiveTrackingQuality, SampleWindow } from "../../src/virtual-try-on-3d/tracking-quality.js";
import { TrackingTimeline } from "../../src/virtual-try-on-3d/tracking-timeline.js";
import { PoseFilter } from "../../src/virtual-try-on-3d/pose-filter.js";
import { trackingMeasurement } from "./tracking-simulation.js";

// A controlled pixel-dependent workload, not a prediction of MediaPipe cost on
// a phone. fixedCost demonstrates that downscaling cannot cure an SDK cost floor.
export function simulateMobilePipeline(baseCost, { backend = "worker", fixedCost = false, duration = 20000 } = {}) {
  const quality = new AdaptiveTrackingQuality({ compact: true, backend });
  const timeline = new TrackingTimeline(), filter = new PoseFilter();
  if (backend === "worker") timeline.computeHeadroom = 1;
  const costs = new SampleWindow(), deliveries = new SampleWindow(), changes = [];
  let pending = null, nextRender = 0, firstValid = false, hidden = 0, frames = 0, scaleError = 0;
  let lastReceipt = null, previousFrames = 0, previousDrops = 0, finalMaxHoldMs = 0;
  for (let now = 0; now <= duration; now++) {
    if (pending && now >= pending.receipt) {
      const interval = lastReceipt === null ? 0 : now - lastReceipt;
      quality.observe({ sdkMs: pending.cost, deliveryMs: interval, now,
        busyDropRatio: (timeline.busyDropped - previousDrops) / Math.max(1, timeline.cameraFrames - previousFrames) });
      previousFrames = timeline.cameraFrames; previousDrops = timeline.busyDropped;
      timeline.finish(pending.capture, pending.cost, now);
      const pose = trackingMeasurement(pending.capture / 33); pose.scale = 3;
      filter.update(pose, pending.capture, now, timeline.expectedDeliveryInterval(now));
      costs.add(pending.cost); if (interval) deliveries.add(interval);
      lastReceipt = now; pending = null; firstValid = true;
      if (changes.length !== quality.changes) changes.push({ now, maxDimension: quality.profile.maxDimension });
    }
    if (now % 33 === 0 && timeline.observe(now / 1000) && timeline.begin(now, quality.minimumIntervalMs)) {
      const dimension = quality.profile.maxDimension;
      const cost = fixedCost ? baseCost : Math.round(8 + (baseCost - 8) * (dimension / 640) ** 2);
      pending = { capture: now, receipt: now + cost, cost };
    }
    if (now >= nextRender) {
      nextRender += 1000 / 60;
      if (backend === "main-thread" && pending) continue;
      filter.setExpectedDeliveryInterval(timeline.expectedDeliveryInterval(now));
      const pose = filter.sample(now); frames++;
      if (firstValid && !pose) hidden++;
      if (pose) scaleError = Math.max(scaleError, Math.abs(pose.scale - 3));
      if (now > duration - 2000 && pose) finalMaxHoldMs = Math.max(finalMaxHoldMs, now - lastReceipt);
    }
  }
  return { baseCostMs: baseCost, backend, fixedCost, changes, frames, hidden, scaleError, finalMaxHoldMs,
    finalProfile: quality.profile.name, finalSdkP50Ms: costs.percentile(0.5),
    finalSdkP95Ms: costs.percentile(0.95), finalDeliveryP95Ms: deliveries.percentile(0.95),
    finalGraceMs: filter.currentGraceMs, budgetExceeded: quality.budgetExceeded };
}
