export class SampleWindow {
  constructor(capacity = 32) { this.capacity = capacity; this.samples = []; this.cursor = 0; }
  add(value) {
    if (!Number.isFinite(value) || value < 0) return;
    if (this.samples.length < this.capacity) this.samples.push(value);
    else { this.samples[this.cursor] = value; this.cursor = (this.cursor + 1) % this.capacity; }
  }
  percentile(fraction) {
    if (!this.samples.length) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  }
  clear() { this.samples.length = 0; this.cursor = 0; }
}

const PROFILES = [
  { name: "native", maxDimension: Infinity, targetFps: 0 }, // Preserve the approved fast desktop input and cadence.
  { name: "640", maxDimension: 640, targetFps: 30 },
  { name: "480", maxDimension: 480, targetFps: 20 },
  { name: "360", maxDimension: 360, targetFps: 15 },
];

export function trackingPerformanceBudget(renderFps, inferenceFps, deliveryP95Ms) {
  if (![renderFps, inferenceFps, deliveryP95Ms].every(Number.isFinite)) return "warming-up";
  if (renderFps >= 50 && inferenceFps >= 20 && deliveryP95Ms < 100) return "good";
  if (renderFps >= 45 && inferenceFps >= 12 && deliveryP95Ms < 150) return "acceptable";
  return "exceeded";
}

export class AdaptiveTrackingQuality {
  constructor({ compact = false, backend = "worker" } = {}) {
    this.compact = compact; this.backend = backend;
    this.index = compact ? (backend === "main-thread" ? 2 : 1) : 0;
    this.sdk = new SampleWindow(16); this.delivery = new SampleWindow(16);
    this.badWindows = 0; this.goodWindows = 0; this.count = 0;
    this.changes = 0; this.lastChangeAt = -Infinity; this.reason = "initial";
    this.budgetExceeded = false;
  }
  get profile() { return PROFILES[this.index]; }
  get minimumIntervalMs() {
    const fps = this.profile.targetFps;
    return fps ? 1000 / (this.backend === "main-thread" ? Math.min(fps, 20) : fps) - 1 : 0;
  }
  observe({ sdkMs, deliveryMs, busyDropRatio = 0, now }) {
    this.sdk.add(sdkMs); if (deliveryMs > 0) this.delivery.add(deliveryMs);
    // Disjoint windows and a cooldown keep startup/outliers from oscillating resolution.
    if (++this.count % 8) return false;
    const sdk95 = this.sdk.percentile(0.95), delivery95 = this.delivery.percentile(0.95) ?? sdk95;
    const period = this.profile.targetFps ? 1000 / this.profile.targetFps : 33;
    const sdkBudget = this.index === 0 ? 100 : this.backend === "main-thread" ? 45 : Math.max(45, period);
    const deliveryBudget = Math.max(this.index === 0 ? 150 : 100, period * 1.8);
    const sustainedSdk = this.sdk.samples.filter((v) => v > sdkBudget).length > this.sdk.samples.length * 0.25;
    const sustainedDelivery = this.delivery.samples.filter((v) => v > deliveryBudget).length > this.delivery.samples.length * 0.25;
    const overloaded = (sdk95 > sdkBudget && sustainedSdk) || (delivery95 > deliveryBudget && sustainedDelivery)
      || (busyDropRatio > 0.5 && sdk95 > 35);
    // Delivery includes deliberate profile pacing and the next camera frame.
    // A 20Hz profile on a 30Hz camera delivers around 66ms even with a 12ms SDK;
    // demanding <60ms there would prevent recovery on an idle device forever.
    const spare = sdk95 < (this.backend === "main-thread" ? 18 : 23)
      && delivery95 <= Math.max(60, period + 35) && busyDropRatio < 0.15;
    this.budgetExceeded = this.index === 3 && overloaded;
    this.badWindows = overloaded ? this.badWindows + 1 : 0;
    this.goodWindows = spare ? this.goodWindows + 1 : 0;
    const canLower = this.badWindows >= 2 && this.index < 3 && now - this.lastChangeAt >= 1500;
    const floor = this.compact ? (this.backend === "main-thread" ? 2 : 1) : 0;
    const canRaise = this.goodWindows >= 6 && this.index > floor && now - this.lastChangeAt >= 10000;
    if (!canLower && !canRaise) return false;
    this.index += canLower ? 1 : -1; this.changes++; this.lastChangeAt = now;
    this.reason = canLower ? "sustained-cost" : "sustained-headroom";
    this.badWindows = this.goodWindows = 0; this.sdk.clear(); this.delivery.clear();
    return true;
  }
  metrics() { return { trackingProfile: this.profile.name, trackingTargetFps: this.profile.targetFps || null,
    qualityChangeCount: this.changes, qualityChangeReason: this.reason, trackingBudgetExceeded: this.budgetExceeded }; }
}
