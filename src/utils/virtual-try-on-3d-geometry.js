import { FACE_LANDMARK_INDICES } from "@/constants/virtual-try-on";

const {
  LEFT_EYE_OUTER,
  RIGHT_EYE_OUTER,
  NOSE_BRIDGE,
  NOSE_TIP,
  FOREHEAD,
  CHIN,
} = FACE_LANDMARK_INDICES;

/**
 * Convert normalised MediaPipe landmarks into a glasses pose
 * that can be used directly with Three.js (orthographic camera).
 *
 * The orthographic camera maps [0..videoWidth] → [-halfW..+halfW]
 * and [0..videoHeight] → [+halfH..-halfH]  (Y is flipped).
 */
export function landmarksToGlassesPose(
  landmarks,
  videoWidth,
  videoHeight,
  calibration,
) {
  if (!landmarks || !videoWidth || !videoHeight) return null;

  const lEye = landmarks[LEFT_EYE_OUTER];
  const rEye = landmarks[RIGHT_EYE_OUTER];
  const nose = landmarks[NOSE_BRIDGE];
  const noseTip = landmarks[NOSE_TIP];
  const forehead = landmarks[FOREHEAD];
  const chin = landmarks[CHIN];

  if (!lEye || !rEye || !nose) return null;

  // -- Pixel coordinates (mirrored: MediaPipe x=0 is left of image, but
  //    the camera is already mirrored in display, so we invert x) ----------
  const lx = (1 - lEye.x) * videoWidth;
  const ly = lEye.y * videoHeight;
  const rx = (1 - rEye.x) * videoWidth;
  const ry = rEye.y * videoHeight;
  const nx = (1 - nose.x) * videoWidth;
  const ny = nose.y * videoHeight;

  // -- Measurement ----------------------------------------------------------
  const eyeDistance = Math.hypot(rx - lx, ry - ly);
  if (!Number.isFinite(eyeDistance) || eyeDistance < 8) return null;

  // Centre between eyes (in pixels)
  const cx = (lx + rx) / 2;
  const cy = (ly + ry) / 2;

  // -- Convert to orthographic world coords --------------------------------
  const halfW = videoWidth / 2;
  const halfH = videoHeight / 2;
  const worldX = cx - halfW;
  const worldY = halfH - cy; // flip Y

  // -- Rotations -----------------------------------------------------------
  // Roll: tilt between eyes
  const rollAngle = -Math.atan2(ry - ly, rx - lx);

  // Yaw: horizontal head rotation estimated from nose offset vs eye midpoint
  let yawAngle = 0;
  if (noseTip) {
    const noseTipPx = (1 - noseTip.x) * videoWidth;
    const noseDeviation = (noseTipPx - cx) / (eyeDistance * 0.5);
    yawAngle = noseDeviation * 0.4; // dampened
  }

  // Pitch: vertical head tilt
  let pitchAngle = 0;
  if (forehead && chin) {
    const fhY = forehead.y * videoHeight;
    const chY = chin.y * videoHeight;
    const faceHeight = chY - fhY;
    if (faceHeight > 0) {
      const noseRatio = (ny - fhY) / faceHeight;
      pitchAngle = (noseRatio - 0.38) * 1.2; // 0.38 is neutral
    }
  }

  // -- Scale: proportional to eye distance ---------------------------------
  const baseScale = eyeDistance / 160; // tuned so 160px eye distance ≈ scale 1

  // -- Apply calibration offsets -------------------------------------------
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
    scale: baseScale * calibration.scaleMultiplier,
  };
}

/**
 * Smooth a 3D glasses pose to reduce per-frame jitter.
 */
export function smoothGlassesPose3D(previous, next, factor = 0.35) {
  if (!previous) return next;
  if (!next) return previous;
  const f = Math.min(1, Math.max(0, factor));
  return {
    position: previous.position.map((v, i) => v + (next.position[i] - v) * f),
    rotation: previous.rotation.map((v, i) => {
      const diff = next.rotation[i] - v;
      // Handle angle wrapping for smooth interpolation
      const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
      return v + wrapped * f;
    }),
    scale: previous.scale + (next.scale - previous.scale) * f,
  };
}
