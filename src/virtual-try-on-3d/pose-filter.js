import { Quaternion, Vector3 } from "three";

export const MAX_PREDICTION_MS = 25;
export const MIN_TRACKING_GRACE_MS = 180; // Preserve the approved fast-device dropout window.
export const MAX_TRACKING_GRACE_MS = 800; // Bound a frozen pose to less than one second.
const GRACE_DELIVERY_INTERVALS = 3; // Two missed deliveries plus the next expected result.
const PREDICTION_FADE_MS = 50;
const TAU = 2 * Math.PI;
const ANGULAR_PREDICTION_NOISE_RADIANS = 0.006; // Sub-degree noise must not drive angular extrapolation.
const alpha = (cutoff, dt) => 1 - Math.exp(-TAU * cutoff * dt);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export class OneEuroFilter {
  constructor(minCutoff, beta, derivativeCutoff = 2) {
    this.minCutoff = minCutoff; this.beta = beta; this.derivativeCutoff = derivativeCutoff;
    this.value = null; this.raw = null; this.derivative = 0; this.lastAlpha = 1;
  }
  update(value, dt) {
    if (this.value === null) { this.value = this.raw = value; return value; }
    const velocity = (value - this.raw) / dt;
    this.derivative += alpha(this.derivativeCutoff, dt) * (velocity - this.derivative);
    // Raw velocity responds in one sample; filtered derivative stabilizes jitter.
    const speed = Math.max(Math.abs(this.derivative), Math.abs(velocity) * 0.5);
    this.lastAlpha = alpha(this.minCutoff + this.beta * speed, dt);
    this.value += this.lastAlpha * (value - this.value); this.raw = value;
    return this.value;
  }
}

/** Filter once per measurement; evaluate at display refresh. No extra rendering
 * lerp. Face mask is in head-local coordinates and follows the exact same pose. */
export class PoseFilter {
  constructor() {
    this.q = new Quaternion(); this.rawQ = new Quaternion(); this.deltaQ = new Quaternion();
    this.predictedQ = new Quaternion(); this.axis = new Vector3();
    this.reset();
  }
  reset() {
    this.lastMeasurementTimestamp = -Infinity;
    this.lastReceivedTimestamp = -Infinity;
    this.lastValidMeasurementTimestamp = -Infinity;
    this.lastValidReceivedTimestamp = -Infinity;
    this.deliveryIntervalMs = 0;
    this.currentGraceMs = MIN_TRACKING_GRACE_MS;
    this.trackingState = "SEARCHING";
    this.latestResultHadPose = false;
    this.poseAcceptedCount = 0; this.poseRejectedCount = 0;
    this.temporaryMissCount = 0; this.visibilityTimeoutCount = 0;
    this.poseRejectReason = null;
    this.resetMotion();
  }
  resetMotion() {
    this.pose = null;
    this.position = [0, 1, 2].map(() => new OneEuroFilter(2.5, 0.12));
    this.scale = new OneEuroFilter(1.5, 3);
    this.temples = [new OneEuroFilter(4, 8), new OneEuroFilter(4, 8)];
    this.velocity = [0, 0, 0]; this.angularSpeed = 0; this.rotationAlpha = 1;
    this.rawPosition = [0, 0, 0]; this.output = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], templeBends: [0, 0] };
  }
  setExpectedDeliveryInterval(intervalMs) {
    if (Number.isFinite(intervalMs) && intervalMs >= 0) {
      this.currentGraceMs = clamp(Math.max(this.deliveryIntervalMs, intervalMs)
        * GRACE_DELIVERY_INTERVALS, MIN_TRACKING_GRACE_MS, MAX_TRACKING_GRACE_MS);
    }
  }
  expire(now) {
    if (this.pose && now - this.lastValidReceivedTimestamp > this.currentGraceMs) {
      this.resetMotion();
      this.latestResultHadPose = false;
      this.trackingState = "LOST";
      this.visibilityTimeoutCount++;
    }
  }
  // Measurement time drives motion; receipt time drives liveness. Defaults keep
  // synchronous/fixture callers compatible without inventing a second clock.
  update(pose, measurementTimestamp, receivedTimestamp = measurementTimestamp, expectedIntervalMs = 0) {
    const reject = (reason) => { this.poseRejectedCount++; this.poseRejectReason = reason; return false; };
    if (!Number.isFinite(measurementTimestamp) || !Number.isFinite(receivedTimestamp)
      || receivedTimestamp < measurementTimestamp) return reject("invalid-timestamps");
    if (measurementTimestamp <= this.lastMeasurementTimestamp) return reject("stale-measurement");
    if (receivedTimestamp < this.lastReceivedTimestamp) return reject("stale-receipt");
    // Include the just-observed SDK cost before expiring. A synchronous fallback
    // can block RAF, so it could not report its growing in-flight cost earlier.
    this.setExpectedDeliveryInterval(Math.max(expectedIntervalMs, receivedTimestamp - measurementTimestamp));
    this.expire(receivedTimestamp);
    const interval = receivedTimestamp - this.lastReceivedTimestamp;
    if (Number.isFinite(interval) && interval > 0) {
      this.deliveryIntervalMs = this.deliveryIntervalMs ? this.deliveryIntervalMs * 0.8 + interval * 0.2 : interval;
    }
    this.setExpectedDeliveryInterval(Math.max(expectedIntervalMs, Number.isFinite(interval) ? interval : 0,
      receivedTimestamp - measurementTimestamp));
    this.lastMeasurementTimestamp = measurementTimestamp;
    this.lastReceivedTimestamp = receivedTimestamp;
    this.latestResultHadPose = Boolean(pose);
    this.poseRejectReason = null;
    if (!pose) {
      if (this.pose) { this.temporaryMissCount++; this.trackingState = "TRACKING_GRACE"; }
      // Hold filters and dynamic state; suppress prediction instead of resetting
      // velocity/quaternion/scale/temples on an isolated miss.
      return true;
    }
    const initial = !this.pose;
    const dt = initial ? 1 / 30 : Math.max(0.001, (measurementTimestamp - this.lastValidMeasurementTimestamp) / 1000);
    for (let i = 0; i < 3; i++) {
      const difference = initial ? 0 : pose.position[i] - this.rawPosition[i];
      const speed = difference / dt;
      // A quiet/stop sample cancels extrapolation immediately, without rebound.
      this.velocity[i] = Math.abs(difference) < 0.8 || Math.abs(speed) < 5 ? 0 : clamp(speed, -1800, 1800);
      this.rawPosition[i] = pose.position[i];
      this.position[i].update(pose.position[i], dt);
    }
    this.predictedQ.fromArray(pose.quaternion).normalize();
    if (initial) this.q.copy(this.predictedQ);
    const angle = initial ? 0 : this.rawQ.angleTo(this.predictedQ);
    this.angularSpeed = angle < ANGULAR_PREDICTION_NOISE_RADIANS || angle / dt < 0.12 ? 0 : Math.min(8, angle / dt);
    this.deltaQ.copy(this.rawQ).invert().multiply(this.predictedQ).normalize();
    if (this.deltaQ.w < 0) this.deltaQ.set(-this.deltaQ.x, -this.deltaQ.y, -this.deltaQ.z, -this.deltaQ.w);
    this.axis.set(this.deltaQ.x, this.deltaQ.y, this.deltaQ.z).normalize();
    this.rotationAlpha = alpha(3 + 8 * this.angularSpeed, dt);
    this.q.slerp(this.predictedQ, this.rotationAlpha); this.rawQ.copy(this.predictedQ);
    this.scale.update(pose.scale, dt);
    for (const [i, side] of ["left", "right"].entries()) {
      const required = pose.templeFit?.[side]?.bendRadians ?? pose.templeBendRadians ?? 0;
      const filtered = this.temples[i].update(required, dt);
      // Collision clearance is a lower bound. Do not smooth through the head.
      this.temples[i].value = Math.max(required, filtered);
    }
    this.pose = pose;
    this.lastValidMeasurementTimestamp = measurementTimestamp;
    this.lastValidReceivedTimestamp = receivedTimestamp;
    this.trackingState = "TRACKING"; this.poseAcceptedCount++;
    return true;
  }
  sample(now) {
    this.expire(now);
    if (!this.pose) return null;
    const measurementAge = Math.max(0, now - this.lastValidMeasurementTimestamp);
    const horizon = clamp(measurementAge, 0, MAX_PREDICTION_MS) / 1000;
    // Fade prediction after the short useful horizon; never continue flying
    // during camera stalls/loss. Maximum excursion is 12 camera pixels / 0.1 rad.
    const confidence = this.latestResultHadPose
      ? clamp(1 - Math.max(0, measurementAge - MAX_PREDICTION_MS) / PREDICTION_FADE_MS, 0, 1) : 0;
    const out = this.output;
    for (let i = 0; i < 3; i++) out.position[i] = this.position[i].value + clamp(this.velocity[i] * horizon, -12, 12) * confidence;
    this.deltaQ.setFromAxisAngle(this.axis, Math.min(0.1, this.angularSpeed * horizon) * confidence);
    this.predictedQ.copy(this.q).multiply(this.deltaQ).normalize().toArray(out.quaternion);
    out.scale = this.scale.value; out.faceMesh = this.pose.faceMesh;
    out.headRotation = this.pose.headRotation; out.projection = this.pose.projection;
    out.templeFit = this.pose.templeFit;
    out.templeBends[0] = this.temples[0].value; out.templeBends[1] = this.temples[1].value;
    out.timestamp = this.lastValidMeasurementTimestamp;
    return out;
  }
  metrics(now) {
    const measurementAgeMs = Number.isFinite(this.lastValidMeasurementTimestamp) ? Math.max(0, now - this.lastValidMeasurementTimestamp) : null;
    return { resultAgeMs: measurementAgeMs, measurementAgeMs,
      timeSinceLastValidResultMs: Number.isFinite(this.lastValidReceivedTimestamp) ? Math.max(0, now - this.lastValidReceivedTimestamp) : null,
      measurementTimestamp: Number.isFinite(this.lastMeasurementTimestamp) ? this.lastMeasurementTimestamp : null,
      receivedTimestamp: Number.isFinite(this.lastReceivedTimestamp) ? this.lastReceivedTimestamp : null,
      lastValidMeasurementTimestamp: Number.isFinite(this.lastValidMeasurementTimestamp) ? this.lastValidMeasurementTimestamp : null,
      lastValidReceivedTimestamp: Number.isFinite(this.lastValidReceivedTimestamp) ? this.lastValidReceivedTimestamp : null,
      currentGraceMs: this.currentGraceMs, trackingState: this.trackingState,
      poseAcceptedCount: this.poseAcceptedCount, poseFilterRejectedCount: this.poseRejectedCount,
      poseFilterRejectReason: this.poseRejectReason, temporaryMissCount: this.temporaryMissCount,
      visibilityTimeoutCount: this.visibilityTimeoutCount,
      predictionEnabled: Boolean(this.pose && this.latestResultHadPose && measurementAgeMs < MAX_PREDICTION_MS + PREDICTION_FADE_MS),
      facialSpeedPxPerSecond: Math.hypot(...this.velocity), angularSpeedRadPerSecond: this.angularSpeed,
      positionAlpha: this.position[0].lastAlpha, rotationAlpha: this.rotationAlpha, scaleAlpha: this.scale.lastAlpha };
  }
}
