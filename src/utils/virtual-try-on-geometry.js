const LEFT_EYE_OUTER_INDEX = 33;
const RIGHT_EYE_OUTER_INDEX = 263;

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function angleDifference(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function calculateAutomaticFramePose({
  adjustments,
  calibration,
  height,
  landmarks,
  width,
}) {
  const leftEye = landmarks?.[LEFT_EYE_OUTER_INDEX];
  const rightEye = landmarks?.[RIGHT_EYE_OUTER_INDEX];
  if (!finitePoint(leftEye) || !finitePoint(rightEye) || width <= 0 || height <= 0) {
    return null;
  }

  const left = { x: leftEye.x * width, y: leftEye.y * height };
  const right = { x: rightEye.x * width, y: rightEye.y * height };
  const eyeDistance = Math.hypot(right.x - left.x, right.y - left.y);
  if (!Number.isFinite(eyeDistance) || eyeDistance < 10) return null;

  return {
    angle: Math.atan2(right.y - left.y, right.x - left.x)
      + ((calibration.rotationOffsetDegrees + adjustments.rotationDegrees) * Math.PI) / 180,
    centerX: (left.x + right.x) / 2,
    centerY: (left.y + right.y) / 2
      + eyeDistance * (calibration.verticalOffset + adjustments.verticalOffset),
    width: eyeDistance * calibration.widthScale * adjustments.scale,
  };
}

export function calculateManualFramePose({ adjustments, calibration, height, width }) {
  const reference = Math.min(width, height);
  return {
    angle: ((calibration.rotationOffsetDegrees + adjustments.rotationDegrees) * Math.PI) / 180,
    centerX: width / 2,
    centerY: height * 0.43 + reference * adjustments.verticalOffset * 0.2,
    width: reference * 0.62 * adjustments.scale,
  };
}

export function smoothFramePose(previous, next, factor = 0.35) {
  if (!previous) return next;
  const normalizedFactor = Math.min(1, Math.max(0, factor));
  return {
    angle: previous.angle + angleDifference(previous.angle, next.angle) * normalizedFactor,
    centerX: previous.centerX + (next.centerX - previous.centerX) * normalizedFactor,
    centerY: previous.centerY + (next.centerY - previous.centerY) * normalizedFactor,
    width: previous.width + (next.width - previous.width) * normalizedFactor,
  };
}
