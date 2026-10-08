import { Quaternion, Vector3 } from "three";

export const MAX_PREDICTION_MS = 25;
export const MAX_RESULT_AGE_MS = 180;
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
    this.lastTimestamp = -Infinity; this.lastSeen = -Infinity; this.pose = null;
    this.position = [0, 1, 2].map(() => new OneEuroFilter(2.5, 0.12));
    this.scale = new OneEuroFilter(1.5, 3);
    this.temples = [new OneEuroFilter(4, 8), new OneEuroFilter(4, 8)];
    this.velocity = [0, 0, 0]; this.angularSpeed = 0; this.rotationAlpha = 1;
    this.rawPosition = [0, 0, 0]; this.output = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], templeBends: [0, 0] };
  }
  update(pose, timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= this.lastTimestamp) return false;
    if (!pose) { this.lastTimestamp = timestamp; this.velocity.fill(0); this.angularSpeed = 0; return true; }
    if (timestamp - this.lastSeen > MAX_RESULT_AGE_MS) this.reset();
    const initial = !this.pose, dt = initial ? 1 / 30 : clamp((timestamp - this.lastSeen) / 1000, 0.001, 0.2);
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
    this.pose = pose; this.lastTimestamp = this.lastSeen = timestamp; return true;
  }
  sample(now) {
    if (!this.pose || now - this.lastSeen > MAX_RESULT_AGE_MS) return null;
    const horizon = clamp(now - this.lastSeen, 0, MAX_PREDICTION_MS) / 1000;
    // Fade prediction after the short useful horizon; never continue flying
    // during camera stalls/loss. Maximum excursion is 12 camera pixels / 0.1 rad.
    const confidence = clamp(1 - Math.max(0, now - this.lastSeen - MAX_PREDICTION_MS) / 50, 0, 1);
    const out = this.output;
    for (let i = 0; i < 3; i++) out.position[i] = this.position[i].value + clamp(this.velocity[i] * horizon, -12, 12) * confidence;
    this.deltaQ.setFromAxisAngle(this.axis, Math.min(0.1, this.angularSpeed * horizon) * confidence);
    this.predictedQ.copy(this.q).multiply(this.deltaQ).normalize().toArray(out.quaternion);
    out.scale = this.scale.value; out.faceMesh = this.pose.faceMesh;
    out.headRotation = this.pose.headRotation; out.projection = this.pose.projection;
    out.templeFit = this.pose.templeFit;
    out.templeBends[0] = this.temples[0].value; out.templeBends[1] = this.temples[1].value;
    out.timestamp = this.lastSeen;
    return out;
  }
  metrics(now) {
    return { resultAgeMs: this.pose ? now - this.lastSeen : null,
      facialSpeedPxPerSecond: Math.hypot(...this.velocity), angularSpeedRadPerSecond: this.angularSpeed,
      positionAlpha: this.position[0].lastAlpha, rotationAlpha: this.rotationAlpha, scaleAlpha: this.scale.lastAlpha };
  }
}
