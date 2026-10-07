import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { unprojectVideoPoint } from "./camera-projection.js";

const radians = (degrees) => degrees * Math.PI / 180;
// 3D pair distances from MediaPipe's canonical mesh (the checked-in fixture).
// These are an outlier reference, not per-device calibration or user anatomy.
const CANONICAL_TEMPLE_TO_CHEEK = 1.010296336908492;
const CANONICAL_EYE_TO_CHEEK = 0.5800826493942862;
const projected = (v) => Math.hypot(v.x, v.y);
const angles = (q, prefix) => {
  const e = q && new Euler().setFromQuaternion(q, "XYZ"), deg = 180 / Math.PI;
  return { [`${prefix}Yaw`]: e ? e.y * deg : null, [`${prefix}Pitch`]: e ? e.x * deg : null,
    [`${prefix}Roll`]: e ? e.z * deg : null };
};

/** Source pixels only: neither CSS dimensions nor inference dimensions enter.
 * The canonical mesh supplies anatomical ratios ONLY to detect an outlier.
 * Coherent measurements retain the approved cheek estimate bit for bit. */
export function measureFace(landmarks, width, height, transform, mirrored, projection) {
  const matrix = new Matrix4(), data = transform?.data;
  let matrixQ = null;
  if (data?.length === 16 && Array.from(data).every(Number.isFinite)) {
    // Same column-major convention and selfie S R S as the approved desktop.
    matrix.fromArray(data); matrix.extractRotation(matrix);
    if (mirrored) for (const i of [1, 2, 4, 8]) matrix.elements[i] *= -1;
    if (matrix.determinant() > 0.5) matrixQ = new Quaternion().setFromRotationMatrix(matrix).normalize();
  }
  const point = (i) => new Vector3().fromArray(unprojectVideoPoint(landmarks[i].x * width,
    landmarks[i].y * height, -((landmarks[i].z ?? 0) - (landmarks[6].z ?? 0)) * width, projection));
  const spans = [[33, 263], [234, 454], [127, 356]].map(([a, b]) => point(b).sub(point(a)));
  const x = spans[0].clone().normalize(), up = point(10).sub(point(152)).normalize();
  const z = x.clone().cross(up).normalize(), y = z.clone().cross(x).normalize();
  let landmarkQ = null;
  if (spans[0].length() > 1 && z.lengthSq() >= 0.5) {
    matrix.makeBasis(x, y, z);
    if (mirrored) for (const i of [1, 2, 4, 8]) matrix.elements[i] *= -1;
    landmarkQ = new Quaternion().setFromRotationMatrix(matrix).normalize();
  }
  // One corrupt cheek/temple signal cannot invalidate the other two axes.
  const agreeingAxes = spans.filter((s) => s.length() > 1 && s.clone().normalize().dot(x) > Math.cos(radians(25))).length;
  const matrixProjection = matrixQ && projected(new Vector3(1, 0, 0).applyQuaternion(matrixQ));
  const landmarkProjection = landmarkQ && projected(new Vector3(1, 0, 0).applyQuaternion(landmarkQ));
  const disagreement = matrixQ && landmarkQ ? matrixQ.angleTo(landmarkQ) * 180 / Math.PI : null;
  const rejected = Boolean(matrixQ && landmarkQ && agreeingAxes >= 2 && landmarkProjection > 0.3
    && (disagreement > 35 || landmarkProjection / Math.max(matrixProjection, 1e-6) > 1.5));
  const quaternion = rejected ? landmarkQ : matrixQ ?? landmarkQ;
  if (!quaternion) return null;
  const projectionLength = Math.max(0.35, projected(new Vector3(1, 0, 0).applyQuaternion(quaternion)));
  const mirror = (v) => (mirrored ? 1 - v : v) * width;
  const cheek = (i) => unprojectVideoPoint(mirror(landmarks[i].x), landmarks[i].y * height,
    -((landmarks[i].z ?? 0) - (landmarks[6].z ?? 0)) * width, projection);
  const left = cheek(234), right = cheek(454);
  // Preserve the exact order of approved arithmetic, including mirrored X.
  const rawFaceWidthPx = Math.hypot(right[0] - left[0], right[1] - left[1]);
  const candidates = {
    cheeks: rawFaceWidthPx / projectionLength,
    temples: projected(spans[2]) / projectionLength / CANONICAL_TEMPLE_TO_CHEEK,
    eyes: projected(spans[0]) / projectionLength / CANONICAL_EYE_TO_CHEEK,
  };
  const alternative = (candidates.temples + candidates.eyes) / 2;
  const alternativesAgree = Math.abs(candidates.temples - candidates.eyes) / Math.max(alternative, 1) < 0.2;
  const cheekOutlier = alternativesAgree && Math.abs(candidates.cheeks - alternative) / Math.max(alternative, 1) > 0.3;
  const cheekTempleMean = (candidates.cheeks + candidates.temples) / 2;
  const eyeOutlier = Math.abs(candidates.cheeks - candidates.temples) / Math.max(cheekTempleMean, 1) < 0.2
    && Math.abs(candidates.eyes - cheekTempleMean) / Math.max(cheekTempleMean, 1) > 0.3;
  const correctedFaceWidthPx = cheekOutlier ? alternative : candidates.cheeks;
  const eyeDistancePx = Math.hypot((landmarks[263].x - landmarks[33].x) * width,
    (landmarks[263].y - landmarks[33].y) * height);
  const landmarkCheekWidthPx = Math.hypot((landmarks[454].x - landmarks[234].x) * width,
    (landmarks[454].y - landmarks[234].y) * height);
  const templeWidthPx = Math.hypot((landmarks[356].x - landmarks[127].x) * width,
    (landmarks[356].y - landmarks[127].y) * height);
  return { quaternion, correctedFaceWidthPx, eyeDistancePx, eyeOutlier, metrics: {
    videoWidth: width, videoHeight: height, landmarkCheekWidthPx, templeWidthPx, eyeDistancePx, rawFaceWidthPx,
    projectionLength, correctionFactor: 1 / projectionLength, yawCorrectionFactor: 1 / projectionLength,
    correctedFaceWidthPx, widthCandidatesPx: candidates, eyeOutlier, scaleSource: cheekOutlier ? "eyes-temples-consensus" : "cheeks",
    orientationSource: rejected ? "landmarks-consistency" : matrixQ ? "matrix" : "landmarks",
    matrixRejected: rejected, agreeingAxes, orientationDisagreementDegrees: disagreement,
    matrixProjectionLength: matrixProjection, landmarkProjectionLength: landmarkProjection,
    matrixCorrectionFactor: matrixQ ? 1 / Math.max(0.35, matrixProjection) : null,
    ...angles(matrixQ, "matrix"), ...angles(landmarkQ, "landmark"),
  } };
}
