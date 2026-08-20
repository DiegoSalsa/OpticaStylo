import { FACE_LANDMARK_INDICES } from "../constants/virtual-try-on.js";

const {
  LEFT_EYE_OUTER,
  RIGHT_EYE_OUTER,
  NOSE_BRIDGE,
  NOSE_TIP,
  FOREHEAD,
  CHIN,
} = FACE_LANDMARK_INDICES;

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Converts MediaPipe landmarks into the pixel-based coordinate system used by
 * the orthographic Three.js camera. Horizontal coordinates are mirrored to
 * match the selfie video shown to the visitor.
 */
export function landmarksToGlassesPose(
  landmarks,
  videoWidth,
  videoHeight,
  calibration,
) {
  if (!landmarks || videoWidth <= 0 || videoHeight <= 0) return null;

  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];
  const noseBridge = landmarks[NOSE_BRIDGE];
  const noseTip = landmarks[NOSE_TIP];
  const forehead = landmarks[FOREHEAD];
  const chin = landmarks[CHIN];

  if (!finitePoint(leftEye) || !finitePoint(rightEye) || !finitePoint(noseBridge)) {
    return null;
  }

  const leftX = (1 - leftEye.x) * videoWidth;
  const leftY = leftEye.y * videoHeight;
  const rightX = (1 - rightEye.x) * videoWidth;
  const rightY = rightEye.y * videoHeight;
  const noseY = noseBridge.y * videoHeight;
  const eyeDistance = Math.hypot(rightX - leftX, rightY - leftY);

  if (!Number.isFinite(eyeDistance) || eyeDistance < 8) return null;

  const centerX = (leftX + rightX) / 2;
  const centerY = (leftY + rightY) / 2;
  const worldX = centerX - videoWidth / 2;
  const worldY = videoHeight / 2 - centerY;
  const rollAngle = Math.atan2(leftY - rightY, leftX - rightX);

  let yawAngle = 0;
  if (finitePoint(noseTip)) {
    const noseTipX = (1 - noseTip.x) * videoWidth;
    const noseDeviation = (noseTipX - centerX) / eyeDistance;
    yawAngle = clamp(noseDeviation * 1.45, -0.65, 0.65);
  }

  let pitchAngle = 0;
  if (finitePoint(forehead) && finitePoint(chin)) {
    const foreheadY = forehead.y * videoHeight;
    const chinY = chin.y * videoHeight;
    const faceHeight = chinY - foreheadY;
    if (faceHeight > 0) {
      const noseRatio = (noseY - foreheadY) / faceHeight;
      pitchAngle = clamp((noseRatio - 0.38) * 1.15, -0.42, 0.42);
    }
  }

  return {
    position: [
      worldX + calibration.positionOffsetX * eyeDistance,
      worldY - calibration.positionOffsetY * eyeDistance,
      calibration.positionOffsetZ,
    ],
    rotation: [
      pitchAngle + (calibration.rotationOffsetX * Math.PI) / 180,
      yawAngle + (calibration.rotationOffsetY * Math.PI) / 180,
      rollAngle + (calibration.rotationOffsetZ * Math.PI) / 180,
    ],
    // GlassesModel normalises every asset to one unit across, so this value is
    // the desired visible width in video pixels rather than a GLB unit guess.
    scale: eyeDistance * calibration.widthScale,
  };
}

export function smoothGlassesPose3D(previous, next, factor = 0.38) {
  if (!previous) return next;
  if (!next) return previous;
  const normalizedFactor = clamp(factor, 0, 1);
  return {
    position: previous.position.map(
      (value, index) => value + (next.position[index] - value) * normalizedFactor,
    ),
    rotation: previous.rotation.map((value, index) => {
      const difference = next.rotation[index] - value;
      const wrappedDifference = Math.atan2(Math.sin(difference), Math.cos(difference));
      return value + wrappedDifference * normalizedFactor;
    }),
    scale: previous.scale + (next.scale - previous.scale) * normalizedFactor,
  };
}
