import { PoseFilter, MAX_RESULT_AGE_MS } from "./pose-filter.js";

// Dos presupuestos independientes: antigüedad de captura y silencio desde la
// entrega. El segundo nunca permite prolongar una pose más de otros 180 ms.
export const MAX_CAPTURE_AGE_MS = 2 * MAX_RESULT_AGE_MS;

/** Conserva el filtro aprobado y su reloj de medición. La latencia del worker
 * no debe confundirse con una pérdida, ni convertirse en predicción adicional. */
export class TrackingSession {
  constructor(startedAt = 0) {
    this.startedAt = startedAt;
    this.filter = new PoseFilter();
    this.reset();
  }
  reset() {
    this.filter.reset();
    this.lastReceivedAt = -Infinity; this.lastMeasuredAt = -Infinity;
    this.latencyMs = 0; this.intervalMs = 0; this.consecutive = 0;
    this.phase = "unacquired"; this.everAcquired = false;
    this.firstPoseMs = null; this.lossStartedAt = null; this.recoveryMs = null;
    this.recoveries = 0; this.visualLosses = 0; this.rejectedStale = 0;
  }
  update(pose, measuredAt, receivedAt = measuredAt) {
    if (!Number.isFinite(receivedAt) || receivedAt < measuredAt
      || measuredAt <= this.filter.lastTimestamp) return false;
    if (receivedAt - measuredAt > MAX_CAPTURE_AGE_MS) {
      this.rejectedStale++; return false;
    }
    if (!pose) {
      this.consecutive = 0;
      if (this.everAcquired) this.phase = "transient-loss";
      this.lossStartedAt ??= receivedAt;
      return this.filter.update(null, measuredAt);
    }
    const recovering = this.everAcquired && ["lost", "transient-loss"].includes(this.phase);
    if (Number.isFinite(this.lastMeasuredAt)) this.intervalMs = measuredAt - this.lastMeasuredAt;
    this.latencyMs = receivedAt - measuredAt;
    this.lastMeasuredAt = measuredAt; this.lastReceivedAt = receivedAt;
    this.firstPoseMs ??= receivedAt - this.startedAt;
    if (recovering) { this.recoveries++; this.recoveryMs = receivedAt - this.lossStartedAt; }
    this.lossStartedAt = null; this.everAcquired = true;
    this.phase = recovering ? "recovering" : ++this.consecutive >= 3 ? "stable" : "detected";
    return this.filter.update(pose, measuredAt);
  }
  ageBudget() {
    // Dos intervalos medidos toleran una inferencia omitida; el límite absoluto
    // impide que una cámara lenta o detenida justifique una retención indefinida.
    return Math.min(MAX_CAPTURE_AGE_MS, Math.max(MAX_RESULT_AGE_MS,
      this.latencyMs + 2 * (this.intervalMs || 1000 / 30)));
  }
  sample(now) {
    const captureAge = now - this.lastMeasuredAt;
    if (captureAge > this.ageBudget() || now - this.lastReceivedAt > MAX_RESULT_AGE_MS) {
      if (this.everAcquired && this.phase !== "lost") {
        this.phase = "lost"; this.visualLosses++; this.consecutive = 0;
        this.lossStartedAt ??= this.lastReceivedAt;
      }
      return null;
    }
    // El filtro cancela su extrapolación a los 75 ms. Sólo se extiende la
    // disponibilidad de una medición lenta, manteniendo su timestamp verdadero.
    return this.filter.sample(Math.min(now, this.lastMeasuredAt + MAX_RESULT_AGE_MS));
  }
  metrics(now) {
    return { ...this.filter.metrics(now), trackingState: this.phase,
      captureAgeBudgetMs: this.ageBudget(), deliveryAgeMs: this.everAcquired ? now - this.lastReceivedAt : null,
      firstPoseMs: this.firstPoseMs, recoveryMs: this.recoveryMs, recoveries: this.recoveries,
      visualLosses: this.visualLosses, rejectedStaleResults: this.rejectedStale };
  }
}
