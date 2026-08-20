import {
  DEFAULT_3D_CALIBRATION,
  FACE_LANDMARK_INDICES,
} from "../constants/virtual-try-on.js";

const {
  LEFT_EYE_OUTER,
  RIGHT_EYE_OUTER,
  NOSE_BRIDGE,
  NOSE_TIP,
  FOREHEAD,
  CHIN,
  LEFT_EAR,
  RIGHT_EAR,
} = FACE_LANDMARK_INDICES;

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

/**
 * Converts MediaPipe landmarks into a self-fitting glasses pose. The frame
 * width comes from the detected face sides and is constrained by eye distance,
 * so it remains stable without visitor-facing calibration controls.
 */
export function landmarksToGlassesPose(
  landmarks,
  videoWidth,
  videoHeight,
  calibration = DEFAULT_3D_CALIBRATION,
) {
  if (!landmarks || videoWidth <= 0 || videoHeight <= 0) return null;

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

  const eyeDistance = Math.hypot(
    rightEye.x - leftEye.x,
    rightEye.y - leftEye.y,
  );
  const projectedFaceWidth = Math.hypot(
    rightFace.x - leftFace.x,
    rightFace.y - leftFace.y,
  );
  const projectedFaceHeight = Math.hypot(
    chin.x - forehead.x,
    chin.y - forehead.y,
  );
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

  // Both face width and eye distance are corrected back to their approximate
  // frontal measurements. Rotating the GLB then creates the projected shrink
  // exactly once instead of making the frame collapse as the head turns.
  const yawCosine = Math.max(0.68, Math.cos(yawAngle));
  const frontalEyeDistance = eyeDistance / yawCosine;
  const frontalFaceWidth = projectedFaceWidth / yawCosine;
  const faceBasedFrameWidth = frontalFaceWidth * calibration.faceWidthRatio;
  const frameWidth = clamp(
    faceBasedFrameWidth,
    frontalEyeDistance * calibration.minimumEyeWidthScale,
    frontalEyeDistance * calibration.maximumEyeWidthScale,
  );

  const worldX = eyeCenter.x - videoWidth / 2;
  const worldY = videoHeight / 2 - eyeCenter.y
    - calibration.verticalOffset * frontalEyeDistance;
  const headRotation = [pitchAngle, yawAngle, rollAngle];

  const faceRadiusX = frontalFaceWidth * 0.5;
  const faceRadiusY = projectedFaceHeight * 0.53;
  const faceRadiusZ = frontalFaceWidth * 0.34;
  const rotatedFrontRadius = Math.hypot(
    faceRadiusX * Math.sin(yawAngle),
    faceRadiusZ * Math.cos(yawAngle),
  );
  // The nearest point of the invisible head sits between the front rims and
  // the temples in this GLB. It writes depth without covering the camera feed.
  const occluderFrontGap = frameWidth * 0.063;

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
      yawAngle + (calibration.modelYawOffsetDegrees * Math.PI) / 180,
      rollAngle,
    ],
    scale: frameWidth,
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
