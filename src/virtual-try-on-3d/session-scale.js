import { PhysicalScaleEstimator, IRIS_HOLD_MS, IRIS_FALLBACK_TAU_MS, physicalScale } from "./physical-scale.js";

/** Una referencia conservada sigue la distancia facial actual, nunca congela
 * píxeles de una distancia anterior. La confianza y la mezcla aprobadas siguen
 * perteneciendo al estimador original. No depende del dispositivo ni del SKU. */
export class SessionScaleEstimator extends PhysicalScaleEstimator {
  reset() { super.reset(); this.referenceRatio = null; }
  update(faceScale, measurement, width, timestamp) {
    const previousAt = this.lastSampleAt;
    const estimate = super.update(faceScale, measurement, width, timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= previousAt) return estimate;
    if (["iris", "blend"].includes(estimate.scaleSource)) {
      this.referenceRatio = estimate.pixelsPerMm / faceScale;
    } else if (this.referenceRatio !== null && estimate.irisAgeMs !== undefined) {
      const fraction = 1 - Math.exp(-Math.max(0, estimate.irisAgeMs - IRIS_HOLD_MS) / IRIS_FALLBACK_TAU_MS);
      const fallback = physicalScale(faceScale, measurement);
      estimate.pixelsPerMm = faceScale * this.referenceRatio * (1 - fraction) + fallback.pixelsPerMm * fraction;
    }
    return estimate;
  }
}
