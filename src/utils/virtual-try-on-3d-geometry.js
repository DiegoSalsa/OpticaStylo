import { FACE_LANDMARK_INDICES } from "../constants/virtual-try-on.js";

const {
  LEFT_EYE_OUTER,
  RIGHT_EYE_OUTER,
  NOSE_BRIDGE,
  NOSE_TIP,
  FOREHEAD,
  CHIN,
  LEFT_EAR,
  RIGHT_EAR,
  LEFT_TEMPLE,
  RIGHT_TEMPLE,
} = FACE_LANDMARK_INDICES;

const IRIS_DIAMETER_PAIRS = Object.freeze([
  [470, 472],
  [475, 477],
]);
const AVERAGE_IRIS_DIAMETER_MM = 11.7;
const REFERENCE_FACE_WIDTH_MM = 135;

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mirroredPoint(point, videoWidth, videoHeight) {
  return {
    x: (1 - point.x) * videoWidth,
    y: point.y * videoHeight,
  };
}

function pointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function smoothValues(previous, next, factor) {
  return previous.map(
    (value, index) => value + (next[index] - value) * factor,
  );
}

function smoothAngles(previous, next, factor) {
  return previous.map((value, index) => {
    const difference = next[index] - value;
    const wrappedDifference = Math.atan2(Math.sin(difference), Math.cos(difference));
    return value + wrappedDifference * factor;
  });
}

function irisPixelsPerMillimeter(landmarks, videoWidth, videoHeight, irisDiameterMm) {
  const diameters = IRIS_DIAMETER_PAIRS.flatMap(([firstIndex, secondIndex]) => {
    const first = landmarks[firstIndex];
    const second = landmarks[secondIndex];
    if (!finitePoint(first) || !finitePoint(second)) return [];
    const diameter = pointDistance(
      mirroredPoint(first, videoWidth, videoHeight),
      mirroredPoint(second, videoWidth, videoHeight),
    );
    return diameter >= 1.5 ? [diameter] : [];
  });
  if (diameters.length === 0) return null;
  return diameters.reduce((sum, value) => sum + value, 0)
    / diameters.length
    / irisDiameterMm;
}

/**
 * Converts MediaPipe landmarks into a physical-scale glasses pose. The face
 * estimates camera pixels per millimeter; product metadata preserves each
 * frame's real dimensions, so different sizes remain visibly different.
 */
export function landmarksToGlassesPose(
  landmarks,
  videoWidth,
  videoHeight,
  modelMetadata,
) {
  if (!landmarks || videoWidth <= 0 || videoHeight <= 0 || !modelMetadata) return null;

  const leftEyeLandmark = landmarks[LEFT_EYE_OUTER];
  const rightEyeLandmark = landmarks[RIGHT_EYE_OUTER];
  const noseBridgeLandmark = landmarks[NOSE_BRIDGE];
  const noseTipLandmark = landmarks[NOSE_TIP];
  const foreheadLandmark = landmarks[FOREHEAD];
  const chinLandmark = landmarks[CHIN];
  const leftFaceLandmark = landmarks[LEFT_EAR];
  const rightFaceLandmark = landmarks[RIGHT_EAR];

  const requiredPoints = [
    leftEyeLandmark,
    rightEyeLandmark,
    noseBridgeLandmark,
    noseTipLandmark,
    foreheadLandmark,
    chinLandmark,
    leftFaceLandmark,
    rightFaceLandmark,
  ];
  if (!requiredPoints.every(finitePoint)) return null;

  const leftEye = mirroredPoint(leftEyeLandmark, videoWidth, videoHeight);
  const rightEye = mirroredPoint(rightEyeLandmark, videoWidth, videoHeight);
  const noseTip = mirroredPoint(noseTipLandmark, videoWidth, videoHeight);
  const forehead = mirroredPoint(foreheadLandmark, videoWidth, videoHeight);
  const chin = mirroredPoint(chinLandmark, videoWidth, videoHeight);
  const leftFace = mirroredPoint(leftFaceLandmark, videoWidth, videoHeight);
  const rightFace = mirroredPoint(rightFaceLandmark, videoWidth, videoHeight);

  const eyeDistance = pointDistance(leftEye, rightEye);
  const projectedFaceWidth = pointDistance(leftFace, rightFace);
  const projectedFaceHeight = pointDistance(forehead, chin);
  if (eyeDistance < 8 || projectedFaceWidth < eyeDistance || projectedFaceHeight < 8) {
    return null;
  }

  const eyeCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
  };
  const faceCenter = {
    x: (leftFace.x + rightFace.x) / 2,
    y: (forehead.y + chin.y) / 2,
  };

  const noseDeviation = (noseTip.x - eyeCenter.x) / eyeDistance;
  const yawAngle = Math.asin(clamp(noseDeviation * 2.4, -0.72, 0.72));
  const rollAngle = Math.atan2(
    leftEye.y - rightEye.y,
    leftEye.x - rightEye.x,
  );

  const faceHeight = chin.y - forehead.y;
  const noseBridgeY = noseBridgeLandmark.y * videoHeight;
  const noseRatio = faceHeight > 0
    ? (noseBridgeY - forehead.y) / faceHeight
    : 0.38;
  const pitchAngle = clamp((noseRatio - 0.38) * 1.15, -0.42, 0.42);

  const yawCosine = Math.max(0.68, Math.cos(yawAngle));
  const frontalFaceWidth = projectedFaceWidth / yawCosine;
  const fallbackPixelsPerMillimeter = frontalFaceWidth
    / REFERENCE_FACE_WIDTH_MM;
  const measuredPixelsPerMillimeter = irisPixelsPerMillimeter(
    landmarks,
    videoWidth,
    videoHeight,
    AVERAGE_IRIS_DIAMETER_MM,
  );
  const pixelsPerMillimeter = measuredPixelsPerMillimeter === null
    ? fallbackPixelsPerMillimeter
    : clamp(
      measuredPixelsPerMillimeter,
      fallbackPixelsPerMillimeter * 0.72,
      fallbackPixelsPerMillimeter * 1.38,
    );

  const worldX = eyeCenter.x - videoWidth / 2;
  const worldY = videoHeight / 2 - eyeCenter.y
    - modelMetadata.fitting.verticalOffsetMm * pixelsPerMillimeter;
  const headRotation = [pitchAngle, yawAngle, rollAngle];

  const leftTempleLandmark = landmarks[LEFT_TEMPLE];
  const rightTempleLandmark = landmarks[RIGHT_TEMPLE];
  let projectedTempleWidth = projectedFaceWidth * 0.88;
  if (finitePoint(leftTempleLandmark) && finitePoint(rightTempleLandmark)) {
    const detectedTempleWidth = pointDistance(
      mirroredPoint(leftTempleLandmark, videoWidth, videoHeight),
      mirroredPoint(rightTempleLandmark, videoWidth, videoHeight),
    );
    if (detectedTempleWidth > eyeDistance * 0.65) {
      projectedTempleWidth = detectedTempleWidth;
    }
  }

  const faceRadiusX = (projectedTempleWidth / yawCosine) * 0.5;
  const faceRadiusY = projectedFaceHeight * 0.53;
  const faceRadiusZ = faceRadiusX * 0.7;
  const rotatedFrontRadius = Math.hypot(
    faceRadiusX * Math.sin(yawAngle),
    faceRadiusZ * Math.cos(yawAngle),
  );
  const occluderFrontGap = modelMetadata.occlusion.maskFrontDepthMm
    * pixelsPerMillimeter;

  return {
    headRotation,
    occluder: {
      position: [
        faceCenter.x - videoWidth / 2,
        videoHeight / 2 - faceCenter.y,
        -occluderFrontGap - rotatedFrontRadius,
      ],
      rotation: headRotation,
      scale: [faceRadiusX, faceRadiusY, faceRadiusZ],
    },
    position: [worldX, worldY, 0],
    rotation: [
      pitchAngle,
      yawAngle + (modelMetadata.normalization.modelYawOffsetDegrees * Math.PI) / 180,
      rollAngle,
    ],
    scale: pixelsPerMillimeter,
  };
}

export function smoothGlassesPose3D(previous, next, factor = 0.32) {
  if (!previous) return next;
  if (!next) return previous;
  const normalizedFactor = clamp(factor, 0, 1);
  return {
    headRotation: smoothAngles(
      previous.headRotation,
      next.headRotation,
      normalizedFactor,
    ),
    occluder: {
      position: smoothValues(
        previous.occluder.position,
        next.occluder.position,
        normalizedFactor,
      ),
      rotation: smoothAngles(
        previous.occluder.rotation,
        next.occluder.rotation,
        normalizedFactor,
      ),
      scale: smoothValues(
        previous.occluder.scale,
        next.occluder.scale,
        normalizedFactor,
      ),
    },
    position: smoothValues(previous.position, next.position, normalizedFactor),
    rotation: smoothAngles(previous.rotation, next.rotation, normalizedFactor),
    scale: previous.scale + (next.scale - previous.scale) * normalizedFactor,
  };
}
