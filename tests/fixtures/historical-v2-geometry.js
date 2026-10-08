// Frozen 7290abcfdd898b06a77416a5499e958370fb088c; only relative import paths changed. Test-only.
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { runtimeFittingMetadata } from "../../src/virtual-try-on-3d/model-runtime.js";
import { fitTemples } from "../../src/virtual-try-on-3d/temple-fitting.js";
import { cameraProjection, unprojectVideoPoint } from "../../src/virtual-try-on-3d/camera-projection.js";
import { PoseFilter } from "../../src/virtual-try-on-3d/pose-filter.js";

const REFERENCE_FACE_WIDTH_MM = 135;
const FACE_MESH_COUNT = 468;
const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function headQuaternion(landmarks, width, height, transform, mirrored, projection) {
  const matrix = new Matrix4(), data = transform?.data;
  if (data?.length === 16 && Array.from(data).every(Number.isFinite)) {
    // MediaPipe MatrixData is Eigen column-major. Remove uniform metric scale,
    // then conjugate by the screen reflection S: R_display = S R S.
    matrix.fromArray(data);
    matrix.extractRotation(matrix);
    const e = matrix.elements;
    if (mirrored) for (const i of [1, 2, 4, 8]) e[i] *= -1;
    if (matrix.determinant() > 0.5) return new Quaternion().setFromRotationMatrix(matrix).normalize();
  }
  const point = (i) => new Vector3().fromArray(unprojectVideoPoint(landmarks[i].x * width,
    landmarks[i].y * height, -((landmarks[i].z ?? 0) - (landmarks[6].z ?? 0)) * width, projection));
  const x = point(263).sub(point(33)).normalize(), yRaw = point(10).sub(point(152)).normalize();
  const z = x.clone().cross(yRaw).normalize(), y = z.clone().cross(x).normalize();
  if (z.lengthSq() < 0.5) return null;
  matrix.makeBasis(x, y, z);
  if (mirrored) for (const i of [1, 2, 4, 8]) matrix.elements[i] *= -1;
  return new Quaternion().setFromRotationMatrix(matrix).normalize();
}

/** Anatomy, orientation and physical size are separate estimates. Iris values
 * never participate, so looking sideways cannot move or resize the glasses.
 * V2 bridgeSeat=(0,0,0) is aligned to nose landmark 6, a rigid nasal structure. */
export function landmarksToGlassesPose(landmarks, width, height, metadata, transform = null, adjustment = null) {
  if (!metadata || !landmarks || width <= 0 || height <= 0 || landmarks.length < FACE_MESH_COUNT
    || !landmarks.slice(0, FACE_MESH_COUNT).every(finite)) return null;
  const mirrored = adjustment?.mirrored ?? true;
  const projection = cameraProjection(width, height, adjustment?.focalPx ?? width);
  const quaternion = headQuaternion(landmarks, width, height, transform, mirrored, projection);
  if (!quaternion) return null;
  const bridge = landmarks[6], mirror = (x) => (mirrored ? 1 - x : x) * width;
  const eyeDistance = Math.hypot((landmarks[263].x - landmarks[33].x) * width,
    (landmarks[263].y - landmarks[33].y) * height);
  if (eyeDistance < 8) return null;
  const headX = new Vector3(1, 0, 0).applyQuaternion(quaternion);
  const projectionLength = Math.max(0.35, Math.hypot(headX.x, headX.y));
  const cheek = (index) => {
    const lm = landmarks[index];
    return unprojectVideoPoint(mirror(lm.x), lm.y * height, -((lm.z ?? 0) - (bridge.z ?? 0)) * width, projection);
  };
  const leftCheek = cheek(234), rightCheek = cheek(454);
  const faceWidth = Math.hypot(rightCheek[0] - leftCheek[0], rightCheek[1] - leftCheek[1]) / projectionLength;
  if (faceWidth < eyeDistance) return null;
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
  return { position, quaternion: quaternion.toArray(), rotation: [euler.x, euler.y, euler.z],
    headRotation: [euler.x, euler.y, euler.z], scale, projection,
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
