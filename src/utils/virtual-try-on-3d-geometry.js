import { Euler, Quaternion, Vector3 } from "three";
import { runtimeFittingMetadata } from "../virtual-try-on-3d/model-runtime.js";
import { fitTemples } from "../virtual-try-on-3d/temple-fitting.js";
import { cameraProjection } from "../virtual-try-on-3d/camera-projection.js";
import { PoseFilter } from "../virtual-try-on-3d/pose-filter.js";
import { measureFace } from "../virtual-try-on-3d/face-measurement.js";

const REFERENCE_FACE_WIDTH_MM = 135;
const FACE_MESH_COUNT = 468;
const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Anatomy, orientation and physical size are separate estimates. Iris values
 * never participate, so looking sideways cannot move or resize the glasses.
 * V2 bridgeSeat=(0,0,0) is aligned to nose landmark 6, a rigid nasal structure. */
export function landmarksToGlassesPose(landmarks, width, height, metadata, transform = null, adjustment = null) {
  if (!metadata || !landmarks || width <= 0 || height <= 0 || landmarks.length < FACE_MESH_COUNT
    || !landmarks.slice(0, FACE_MESH_COUNT).every(finite)) return null;
  const mirrored = adjustment?.mirrored ?? true;
  const projection = cameraProjection(width, height, adjustment?.focalPx ?? width);
  const measurement = measureFace(landmarks, width, height, transform, mirrored, projection);
  if (!measurement) return null;
  const { quaternion, eyeDistancePx: eyeDistance, correctedFaceWidthPx: faceWidth } = measurement;
  const bridge = landmarks[6], mirror = (x) => (mirrored ? 1 - x : x) * width;
  if (eyeDistance < 8) return null;
  if (faceWidth < eyeDistance && !measurement.eyeOutlier) return null;
  const pixelsPerMm = faceWidth / (adjustment?.faceWidthMm ?? REFERENCE_FACE_WIDTH_MM);
  const scale = pixelsPerMm * clamp(adjustment?.scaleFactor ?? 1, 0.88, 1.12);
  const position = [mirror(bridge.x) - width / 2,
    height / 2 - bridge.y * height - clamp(adjustment?.verticalOffsetMm ?? 0, -6, 6) * pixelsPerMm, 0];
  const inverse = quaternion.clone().invert();
  const nosePosition = new Vector3().fromArray(position);
  const positions = new Float32Array(FACE_MESH_COUNT * 3);
  const scratch = new Vector3();
  const local = (index) => {
    const lm = landmarks[index];
    const z = Math.min(projection.focalPx * 0.8, -((lm.z ?? 0) - (bridge.z ?? 0)) * width);
    const ratio = (projection.focalPx - z) / projection.focalPx;
    return scratch.set((mirror(lm.x) - width / 2) * ratio, (height / 2 - lm.y * height) * ratio, z)
      .sub(nosePosition).applyQuaternion(inverse).divideScalar(scale);
  };
  for (let i = 0; i < FACE_MESH_COUNT; i++) local(i).toArray(positions, i * 3);
  // Four rigid lateral points support independent targets in head space. Sort
  // by local X: source left/right names and selfie reflection may reverse sides.
  const sides = [127, 356, 234, 454].map((i) => local(i).clone()).sort((a, b) => a.x - b.x);
  const halfWidth = Math.max(45, Math.min(85, (sides[3].x - sides[0].x) / 2));
  const faceHeight = Math.max(100, local(10).clone().distanceTo(local(152)));
  const depth = halfWidth * 1.25; // Estimated cranial depth, no ears/back-of-head landmarks.
  const proxy = { center: [(sides[0].x + sides[3].x) / 2, -faceHeight * 0.08, -depth],
    radii: [halfWidth, faceHeight * 0.5, depth * 0.82] };
  const targets = {
    left: [sides[0].x - 1, sides[0].y, -depth],
    right: [sides[3].x + 1, sides[3].y, -depth],
  };
  const fittingMetadata = runtimeFittingMetadata(metadata);
  const templeFit = fitTemples(fittingMetadata, proxy, targets);
  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  const modelFrameWidthMm = metadata.dimensionsMm.frameWidth, finalModelWidthPx = modelFrameWidthMm * scale;
  const diagnostics = { ...measurement.metrics, referenceFaceWidthMm: adjustment?.faceWidthMm ?? REFERENCE_FACE_WIDTH_MM,
    pixelsPerMm, modelFrameWidthMm, finalModelWidthPx, poseScale: scale, pose: { scale },
    normalizedFrameWidth: finalModelWidthPx / width, normalizedFaceWidth: measurement.metrics.rawFaceWidthPx / width,
    frameToFaceRatio: finalModelWidthPx / measurement.metrics.rawFaceWidthPx };
  return { position, quaternion: quaternion.toArray(), rotation: [euler.x, euler.y, euler.z],
    headRotation: [euler.x, euler.y, euler.z], scale, projection, diagnostics,
    faceMesh: { positions, local: true }, templeFit,
    templeBendRadians: Math.max(templeFit.left.bendRadians, templeFit.right.bendRadians) };
}

// Legacy exported helper retained for callers; runtime owns one persistent filter.
export function smoothGlassesPose3D(previous, next, smoothing = null) {
  if (!previous) return next;
  if (!next) return previous;
  if (Number.isFinite(smoothing)) {
    const a = clamp(smoothing, 0, 1), q = new Quaternion().fromArray(previous.quaternion).slerp(new Quaternion().fromArray(next.quaternion), a);
    return { ...next, position: previous.position.map((n, i) => n + a * (next.position[i] - n)),
      quaternion: q.toArray(), scale: previous.scale + a * (next.scale - previous.scale),
      faceMesh: { ...next.faceMesh, positions: Float32Array.from(next.faceMesh.positions, (n, i) => previous.faceMesh.positions[i] + a * (n - previous.faceMesh.positions[i])) } };
  }
  const filter = new PoseFilter(), timestamp = smoothing?.timestamp ?? (previous.timestamp ?? 0) + 33;
  filter.update(previous, previous.timestamp ?? timestamp - 33); filter.update(next, timestamp);
  return filter.sample(timestamp);
}
