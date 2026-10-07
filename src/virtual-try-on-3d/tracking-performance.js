export class MetricWindow {
  constructor(limit = 64) { this.limit = limit; this.values = []; }
  add(value) { if (!Number.isFinite(value) || value < 0) return; this.values.push(value); if (this.values.length > this.limit) this.values.shift(); }
  stats() {
    const sorted = [...this.values].sort((a, b) => a - b), n = sorted.length;
    return { count: n, p50: n ? sorted[Math.ceil(n * 0.5) - 1] : null, p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null };
  }
}

export class TrackingPerformance {
  constructor(compact, backend = "worker") {
    this.compact = compact; this.level = compact ? (backend === "worker" ? 0 : 1) : -1;
    this.inference = new MetricWindow(); this.delivery = new MetricWindow(); this.latency = new MetricWindow();
    this.lastDelivered = null; this.lastChanged = -Infinity; this.samples = 0; this.badWindows = 0; this.goodWindows = 0;
    this.changes = 0; this.renderFps = null;
  }
  get maxDimension() { return this.level < 0 ? Infinity : [640, 480, 360][this.level]; }
  get minIntervalMs() { return this.compact ? 1000 / [30, 24, 20][this.level] - 1 : 0; }
  record(result, deliveredAt, latencyMs, renderFps) {
    this.inference.add(result?.inferenceDurationMs); this.latency.add(latencyMs);
    if (this.lastDelivered !== null) this.delivery.add(deliveredAt - this.lastDelivered);
    this.lastDelivered = deliveredAt; this.renderFps = renderFps;
    this.samples++;
    if (!this.compact || this.samples < 32 || this.samples % 16) return;
    const i = this.inference.stats(), d = this.delivery.stats();
    const bad = i.p95 > 45 || d.p95 > 100 || (renderFps > 0 && renderFps < 45);
    const good = i.p95 < 22 && d.p95 < 70 && renderFps >= 50;
    this.badWindows = bad ? this.badWindows + 1 : 0;
    this.goodWindows = good ? this.goodWindows + 1 : 0;
    // Lower only after two bad windows. Restore after six good windows and
    // at least 10 s. Both decisions discard old resolution samples.
    if (this.level < 2 && this.badWindows >= 2 && deliveredAt - this.lastChanged >= 3000) this.change(this.level + 1, deliveredAt);
    else if (this.level > 0 && this.goodWindows >= 6 && deliveredAt - this.lastChanged >= 10000) this.change(this.level - 1, deliveredAt);
  }
  change(level, now) {
    this.level = level; this.lastChanged = now; this.changes++; this.samples = 0;
    this.badWindows = this.goodWindows = 0;
    this.inference.values.length = this.delivery.values.length = this.latency.values.length = 0;
  }
  metrics() {
    const inference = this.inference.stats(), delivery = this.delivery.stats(), latency = this.latency.stats();
    const warm = inference.count < 32;
    return { trackingMaxDimension: Number.isFinite(this.maxDimension) ? this.maxDimension : "native",
      inferenceP50Ms: inference.p50, inferenceP95Ms: inference.p95, deliveryP50Ms: delivery.p50, deliveryP95Ms: delivery.p95,
      latencyP50Ms: latency.p50, latencyP95Ms: latency.p95, performanceSamples: inference.count, resolutionChanges: this.changes,
      performanceBudget: warm ? "warming-up" : inference.p95 <= 45 && delivery.p95 <= 100 && this.renderFps >= 45 ? "within" : "exceeded" };
  }
}
