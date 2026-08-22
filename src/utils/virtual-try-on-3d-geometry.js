import { FACE_LANDMARK_INDICES } from "../constants/virtual-try-on.js";
import { Euler, Quaternion } from "three";

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
const FACE_MESH_LANDMARK_COUNT = 468;

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

function applySoftDeadZone(previous, next, threshold) {
  const difference = next - previous;
  const magnitude = Math.abs(difference);
  if (magnitude <= threshold) return previous;
  return next - Math.sign(difference) * threshold;
}

function smoothAngles(previous, next, factor) {
  return previous.map((value, index) => {
    const difference = next[index] - value;
    const wrappedDifference = Math.atan2(Math.sin(difference), Math.cos(difference));
    return value + wrappedDifference * factor;
  });
}

function quaternionFromEuler(rotation) {
  return new Quaternion().setFromEuler(new Euler(...rotation, "XYZ"));
}

function quaternionArrayFromEuler(rotation) {
  return quaternionFromEuler(rotation).toArray();
}

function eulerFromQuaternionArray(quaternion) {
  const value = new Quaternion().fromArray(quaternion).normalize();
  const euler = new Euler().setFromQuaternion(value, "XYZ");
  return [euler.x, euler.y, euler.z];
}

function slerpQuaternionArrays(previous, next, factor) {
  return new Quaternion()
    .fromArray(previous)
    .normalize()
    .slerp(new Quaternion().fromArray(next).normalize(), factor)
    .normalize()
    .toArray();
}

function quaternionAngle(previous, next) {
  const first = new Quaternion().fromArray(previous).normalize();
  const second = new Quaternion().fromArray(next).normalize();
  return first.angleTo(second);
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

function wrappedAngleDistance(first, second) {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function closestSignedAngle(angle, fallback) {
  return wrappedAngleDistance(angle, fallback) <= wrappedAngleDistance(-angle, fallback)
    ? angle
    : -angle;
}

function rotationFromFaceTransform(faceTransform, fallbackRotation) {
  const data = faceTransform?.data;
  if ((!Array.isArray(data) && !ArrayBuffer.isView(data)) || data.length !== 16) {
    return fallbackRotation;
  }

  const scaleX = Math.hypot(data[0], data[1], data[2]);
  const scaleY = Math.hypot(data[4], data[5], data[6]);
  const scaleZ = Math.hypot(data[8], data[9], data[10]);
  if (scaleX === 0 || scaleY === 0 || scaleZ === 0) return fallbackRotation;

  const m11 = data[0] / scaleX;
  const m12 = data[4] / scaleY;
  const m13 = data[8] / scaleZ;
  const m22 = data[5] / scaleY;
  const m23 = data[9] / scaleZ;
  const m32 = data[6] / scaleY;
  const m33 = data[10] / scaleZ;
  const y = Math.asin(clamp(m13, -1, 1));
  const singular = Math.abs(m13) >= 0.9999999;
  const x = singular ? Math.atan2(m32, m22) : Math.atan2(-m23, m33);
  const z = singular ? 0 : Math.atan2(-m12, m11);

  return [
    clamp(closestSignedAngle(x, fallbackRotation[0]), -0.55, 0.55),
    clamp(closestSignedAngle(y, fallbackRotation[1]), -1.05, 1.05),
    clamp(closestSignedAngle(z, fallbackRotation[2]), -0.7, 0.7),
  ];
}

function faceMeshPositions(
  landmarks,
  videoWidth,
  videoHeight,
  noseBridgeDepth,
  baseDepth,
  maximumDepthOffset,
) {
  const positions = new Float32Array(FACE_MESH_LANDMARK_COUNT * 3);
  for (let index = 0; index < FACE_MESH_LANDMARK_COUNT; index += 1) {
    const landmark = landmarks[index];
    const point = mirroredPoint(landmark, videoWidth, videoHeight);
    const landmarkDepth = Number.isFinite(landmark.z) ? landmark.z : noseBridgeDepth;
    const relativeDepth = clamp(
      -(landmarkDepth - noseBridgeDepth) * videoWidth,
      -maximumDepthOffset,
      maximumDepthOffset,
    );
    const offset = index * 3;
    positions[offset] = point.x - videoWidth / 2;
    positions[offset + 1] = videoHeight / 2 - point.y;
    positions[offset + 2] = baseDepth + relativeDepth;
  }
  return positions;
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
  faceTransform = null,
  fitAdjustment = null,
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
  const noseDeviation = (noseTip.x - eyeCenter.x) / eyeDistance;
  const fallbackYawAngle = Math.asin(clamp(noseDeviation * 2.4, -0.72, 0.72));
  const fallbackRollAngle = Math.atan2(
    leftEye.y - rightEye.y,
    leftEye.x - rightEye.x,
  );

  const faceHeight = chin.y - forehead.y;
  const noseBridgeY = noseBridgeLandmark.y * videoHeight;
  const noseRatio = faceHeight > 0
    ? (noseBridgeY - forehead.y) / faceHeight
    : 0.38;
  const fallbackPitchAngle = clamp((noseRatio - 0.38) * 1.15, -0.42, 0.42);
  const [pitchAngle, yawAngle, rollAngle] = rotationFromFaceTransform(
    faceTransform,
    [fallbackPitchAngle, fallbackYawAngle, fallbackRollAngle],
  );

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
  const boundedMeasuredScale = measuredPixelsPerMillimeter === null
    ? null
    : clamp(
      measuredPixelsPerMillimeter,
      fallbackPixelsPerMillimeter * 0.72,
      fallbackPixelsPerMillimeter * 1.38,
    );
  const pixelsPerMillimeter = boundedMeasuredScale === null
    ? fallbackPixelsPerMillimeter
    : fallbackPixelsPerMillimeter * 0.55 + boundedMeasuredScale * 0.45;

  const scaleFactor = clamp(fitAdjustment?.scaleFactor ?? 1, 0.88, 1.12);
  const extraVerticalOffsetMm = clamp(fitAdjustment?.verticalOffsetMm ?? 0, -6, 6);
  const worldX = eyeCenter.x - videoWidth / 2;
  const worldY = videoHeight / 2 - eyeCenter.y
    - (modelMetadata.fitting.verticalOffsetMm + extraVerticalOffsetMm)
      * pixelsPerMillimeter;
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
  const faceRadiusZ = faceRadiusX * 0.7;
  const faceTempleWidthMm = (faceRadiusX * 2) / pixelsPerMillimeter;
  const hingeWidthMm = pointDistance(
    {
      x: modelMetadata.anchorsRaw.hingeLeft[0]
        * modelMetadata.normalization.millimetersPerUnit,
      y: 0,
    },
    {
      x: modelMetadata.anchorsRaw.hingeRight[0]
        * modelMetadata.normalization.millimetersPerUnit,
      y: 0,
    },
  );
  const templeSplayPerSideMm = Math.max(0, faceTempleWidthMm - hingeWidthMm) * 0.5;
  const templeBendRadians = clamp(
    Math.atan2(templeSplayPerSideMm, modelMetadata.dimensionsMm.templeLength),
    0,
    0.14,
  );
  const occluderFrontGap = modelMetadata.occlusion.maskFrontDepthMm
    * pixelsPerMillimeter;
  const noseBridgeDepth = Number.isFinite(noseBridgeLandmark.z)
    ? noseBridgeLandmark.z
    : 0;

  const rotation = [
    pitchAngle,
    yawAngle + (modelMetadata.normalization.modelYawOffsetDegrees * Math.PI) / 180,
    rollAngle,
  ];

  return {
    headRotation,
    faceMesh: {
      positions: faceMeshPositions(
        landmarks,
        videoWidth,
        videoHeight,
        noseBridgeDepth,
        -occluderFrontGap,
        faceRadiusZ,
      ),
    },
    position: [worldX, worldY, 0],
    quaternion: quaternionArrayFromEuler(rotation),
    rotation,
    scale: pixelsPerMillimeter * scaleFactor,
    templeBendRadians,
  };
}

function resolveSmoothingFactors(previous, next, smoothing) {
  if (Number.isFinite(smoothing)) {
    const factor = clamp(smoothing, 0, 1);
    return {
      mesh: factor,
      motion: 1,
      position: factor,
      rotation: factor,
      scale: factor,
    };
  }

  const timestamp = Number.isFinite(smoothing?.timestamp)
    ? smoothing.timestamp
    : (previous.timestamp ?? 0) + 40;
  const elapsedMs = clamp(timestamp - (previous.timestamp ?? timestamp - 40), 16, 120);
  const frameCompensation = elapsedMs / 40;
  const movement = Math.hypot(
    next.position[0] - previous.position[0],
    next.position[1] - previous.position[1],
    next.position[2] - previous.position[2],
  );
  const angle = quaternionAngle(
    previous.quaternion ?? quaternionArrayFromEuler(previous.rotation),
    next.quaternion ?? quaternionArrayFromEuler(next.rotation),
  );
  const scaleChange = Math.abs(next.scale - previous.scale)
    / Math.max(previous.scale, 0.0001);
  const motion = Math.max(
    clamp(movement / 36, 0, 1),
    clamp(angle / 0.32, 0, 1),
    clamp(scaleChange / 0.12, 0, 1),
  );

  const compensated = (base) => 1 - ((1 - base) ** frameCompensation);
  return {
    mesh: compensated(0.24 + motion * 0.32),
    motion,
    position: compensated(0.12 + motion * 0.5),
    rotation: compensated(0.1 + motion * 0.58),
    scale: compensated(0.08 + motion * 0.3),
    timestamp,
  };
}

export function smoothGlassesPose3D(previous, next, smoothing = null) {
  if (!previous) return next;
  if (!next) return previous;
  const factors = resolveSmoothingFactors(previous, next, smoothing);
  const previousQuaternion = previous.quaternion
    ?? quaternionArrayFromEuler(previous.rotation);
  const nextQuaternion = next.quaternion
    ?? quaternionArrayFromEuler(next.rotation);
  const stillness = 1 - factors.motion;
  const rotationDeadZone = 0.008 * stillness;
  const angle = quaternionAngle(previousQuaternion, nextQuaternion);
  const stabilizedNextQuaternion = angle <= rotationDeadZone
    ? previousQuaternion
    : slerpQuaternionArrays(
      previousQuaternion,
      nextQuaternion,
      1 - rotationDeadZone / angle,
    );
  const quaternion = slerpQuaternionArrays(
    previousQuaternion,
    stabilizedNextQuaternion,
    factors.rotation,
  );
  const positionDeadZone = 0.55 * stillness;
  const stabilizedPosition = previous.position.map((value, index) => (
    applySoftDeadZone(
      value,
      next.position[index],
      index === 2 ? positionDeadZone * 0.5 : positionDeadZone,
    )
  ));
  const scaleDeadZone = previous.scale * 0.0025 * stillness;
  const stabilizedScale = applySoftDeadZone(previous.scale, next.scale, scaleDeadZone);
  return {
    headRotation: smoothAngles(
      previous.headRotation,
      next.headRotation,
      factors.rotation,
    ),
    faceMesh: {
      positions: smoothValues(
        previous.faceMesh.positions,
        next.faceMesh.positions,
        factors.mesh,
      ),
    },
    position: smoothValues(previous.position, stabilizedPosition, factors.position),
    quaternion,
    rotation: eulerFromQuaternionArray(quaternion),
    scale: previous.scale + (stabilizedScale - previous.scale) * factors.scale,
    templeBendRadians: previous.templeBendRadians
      + (next.templeBendRadians - previous.templeBendRadians) * factors.scale,
    timestamp: factors.timestamp,
  };
}
