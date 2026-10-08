import { AVERAGE_IRIS_DIAMETER_MM, landmarkDistancePx } from "./scale-comparison.js";

// MediaPipe's anatomical RIGHT iris is 469..472, LEFT is 474..477.
// Opposite vertices in the official rings are the two diameters per eye:
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
// Centers 468/473 and all iris z values are intentionally unused.
export const IRIS_DIAMETER_PAIRS = Object.freeze([
  Object.freeze([469, 471]), Object.freeze([470, 472]),
  Object.freeze([474, 476]), Object.freeze([475, 477]),
]);
// 11.7 mm is an approximate population reference, not a per-model tuning knob.
// Confidence below describes geometric consistency, not a calibrated probability.
export const IRIS_HOLD_MS = 500;
export const IRIS_FALLBACK_TAU_MS = 300;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null;
};

/** Public also for replaying aggregate debug measurements without storing faces.
 * Thresholds are dimensionless so doubling video resolution doubles px/mm.
 * No iris location, gaze direction, face-width prior or product participates. */
export function irisScaleFromDiameters(diameters, width, height, openings) {
  const minimum = Math.min(width, height) * 0.003;
  const valid = diameters.filter((d) => Number.isFinite(d) && d >= minimum && d > 0);
  const center = median(valid);
  const inliers = diameters.map((d) => Number.isFinite(d) && d >= minimum && d > 0
    && Math.abs(d / center - 1) <= 0.25 ? d : null);
  const eyes = [0, 1].map((eye) => {
    const values = inliers.slice(eye * 2, eye * 2 + 2).filter((d) => d !== null);
    const diameter = median(values);
    const opening = openings?.[eye];
    // FaceLandmarker can emit plausible iris points even with a closed eyelid.
    // Lid aperture, independent of iris center, invalidates that measurement.
    const visible = diameter !== null && Number.isFinite(opening) && opening / diameter >= 0.35;
    return { diameter: visible ? diameter : null, count: visible ? values.length : 0,
      high: visible && values.length === 2 && Math.min(...values) / Math.max(...values) >= 0.85
        && opening / diameter >= 0.5 };
  });
  const usable = eyes.filter((eye) => eye.diameter !== null);
  const consistency = usable.length === 2
    ? Math.abs(eyes[0].diameter - eyes[1].diameter) / Math.max(eyes[0].diameter, eyes[1].diameter) : null;
  const rejected = usable.length === 0 || (consistency !== null && consistency > 0.18);
  const accepted = rejected ? [] : eyes.flatMap((eye, index) => eye.diameter === null ? []
    : inliers.slice(index * 2, index * 2 + 2).filter((d) => d !== null));
  const diameter = median(accepted);
  const high = !rejected && eyes.every((eye) => eye.high) && consistency <= 0.1;
  return { irisScalePxPerMm: diameter === null ? null : diameter / AVERAGE_IRIS_DIAMETER_MM,
    irisDiameterPxRight: eyes[0].diameter, irisDiameterPxLeft: eyes[1].diameter,
    irisDiametersPx: diameters, irisInlierCount: accepted.length,
    irisConsistency: consistency, irisConfidence: high ? "high" : rejected ? "invalid" : "medium",
    irisRejectionReason: rejected ? (usable.length ? "left-right-inconsistent" : "missing-or-closed") : null };
}

export function measureIrisScale(landmarks, width, height) {
  return irisScaleFromDiameters(IRIS_DIAMETER_PAIRS.map(([a, b]) => landmarkDistancePx(landmarks, a, b, width, height)),
    width, height, [landmarkDistancePx(landmarks, 159, 145, width, height),
      landmarkDistancePx(landmarks, 386, 374, width, height)]);
}

export function physicalScale(faceScale, measurement) {
  const weight = measurement.irisConfidence === "high" ? 1 : measurement.irisConfidence === "medium" ? 0.45 : 0;
  // A good physical reference is never clamped to a percentage of the 135 mm prior.
  return { pixelsPerMm: weight ? faceScale * (1 - weight) + measurement.irisScalePxPerMm * weight : faceScale,
    irisWeight: weight, scaleSource: weight === 1 ? "iris" : weight ? "blend" : "face" };
}

/** Scale-only session state; PoseFilter still owns the existing scale filter.
 * Hold in px/mm/videoWidth (resolution independent), then transition to the
 * face fallback. Temporal consistency uses iris/face ratio, so approaching
 * the camera does not count as noise or lose response to real distance. */
export class PhysicalScaleEstimator {
  constructor() { this.reset(); }
  reset() {
    this.lastSampleAt = -Infinity; this.lastValidAt = -Infinity;
    this.lastNormalized = null; this.history = []; this.stableSince = null;
    this.trusted = false;
    this.lastConfidence = null; this.pendingRatio = null; this.pendingCount = 0;
  }
  update(faceScale, measurement, width, timestamp) {
    if (!Number.isFinite(timestamp)) return physicalScale(faceScale, measurement);
    if (timestamp <= this.lastSampleAt) return this.lastNormalized === null
      ? physicalScale(faceScale, measurement)
      : { pixelsPerMm: this.lastNormalized * width, irisWeight: 0, scaleSource: "stale-held" };
    if (timestamp - this.lastSampleAt > 1000) this.reset();
    this.lastSampleAt = timestamp;
    const ratio = measurement.irisScalePxPerMm / faceScale;
    let valid = measurement.irisScalePxPerMm !== null;
    // Short partial-eye/blink intervals must not revert a trusted iris scale
    // to a blend dominated by the generic facial prior.
    if (this.lastConfidence === "high" && measurement.irisConfidence !== "high") valid = false;
    const previousRatio = median(this.history);
    if (valid && previousRatio !== null && Math.abs(ratio / previousRatio - 1) > 0.2) {
      this.pendingCount = this.pendingRatio !== null && Math.abs(ratio / this.pendingRatio - 1) < 0.04
        ? this.pendingCount + 1 : 1;
      this.pendingRatio = ratio;
      valid = this.pendingCount >= 3;
      if (valid) { this.history = []; this.stableSince = null; this.trusted = false; }
    } else if (valid) { this.pendingCount = 0; this.pendingRatio = null; }
    if (valid) {
      this.history.push(ratio);
      if (this.history.length > 6) this.history.shift();
      const center = median(this.history);
      const stable = measurement.irisConfidence === "high"
        && this.history.every((r) => Math.abs(r / center - 1) <= 0.04);
      if (!stable) this.stableSince = null;
      else this.stableSince ??= timestamp;
      const trust = stable && this.history.length >= 3
        ? clamp((timestamp - this.stableSince - 80) / 160, 0, 1) : 0;
      // Once established, ordinary changes in the facial prior must not
      // override clear iris measurements. The existing scale filter handles noise.
      const irisWeight = this.trusted && measurement.irisConfidence === "high" ? 1 : 0.45 + 0.55 * trust;
      this.trusted ||= trust === 1;
      const pixelsPerMm = faceScale * (1 - irisWeight) + measurement.irisScalePxPerMm * irisWeight;
      this.lastNormalized = pixelsPerMm / width; this.lastValidAt = timestamp;
      this.lastConfidence = measurement.irisConfidence;
      return { pixelsPerMm, irisWeight, scaleSource: irisWeight === 1 ? "iris" : "blend", irisStable: this.trusted };
    }
    if (this.lastNormalized === null) return { pixelsPerMm: faceScale, irisWeight: 0, scaleSource: "face", irisStable: false };
    const age = timestamp - this.lastValidAt;
    const fraction = 1 - Math.exp(-Math.max(0, age - IRIS_HOLD_MS) / IRIS_FALLBACK_TAU_MS);
    const fallback = physicalScale(faceScale, measurement);
    return { pixelsPerMm: this.lastNormalized * width * (1 - fraction) + fallback.pixelsPerMm * fraction,
      irisWeight: 0, scaleSource: age <= IRIS_HOLD_MS ? "iris-held" : `${fallback.scaleSource}-transition`, irisStable: false,
      irisAgeMs: age };
  }
}
