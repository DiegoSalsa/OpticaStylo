import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { unprojectVideoPoint } from "./camera-projection.js";

const projectionLength = (axis) => Math.hypot(axis.x, axis.y);
const degrees = (v) => v * 180 / Math.PI;
export function resolveFaceOrientation(landmarks, width, height, transform, mirrored, projection) {
  const matrix = new Matrix4(), data = transform?.data;
  let matrixQuaternion = null;
  if (data?.length === 16 && Array.from(data).every(Number.isFinite)) {
    // MatrixData/Eigen is column-major. Reflection is conjugation S R S,
    // never a quaternion component swap or an extra image rotation.
    matrix.fromArray(data); matrix.extractRotation(matrix);
    if (mirrored) for (const i of [1, 2, 4, 8]) matrix.elements[i] *= -1;
    if (matrix.determinant() > 0.5) matrixQuaternion = new Quaternion().setFromRotationMatrix(matrix).normalize();
  }
  const point = (i) => new Vector3().fromArray(unprojectVideoPoint(landmarks[i].x * width,
    landmarks[i].y * height, -((landmarks[i].z ?? 0) - (landmarks[6].z ?? 0)) * width, projection));
  const pairs = [[33, 263], [234, 454], [127, 356]].map(([a, b]) => point(b).sub(point(a)));
  const axes = pairs.filter((v) => v.length() > 1).map((v) => v.clone().normalize());
  const x = pairs[0].clone().normalize(), yRaw = point(10).sub(point(152)).normalize();
  const z = x.clone().cross(yRaw).normalize(), y = z.clone().cross(x).normalize();
  let geometricQuaternion = null;
  if (z.lengthSq() >= 0.5) {
    matrix.makeBasis(x, y, z);
    if (mirrored) for (const i of [1, 2, 4, 8]) matrix.elements[i] *= -1;
    geometricQuaternion = new Quaternion().setFromRotationMatrix(matrix).normalize();
  }
  const signalsAgree = axes.length >= 2 && axes.every((axis) => axis.dot(x) > Math.cos(25 * Math.PI / 180));
  const geometricProjection = geometricQuaternion ? projectionLength(new Vector3(1, 0, 0).applyQuaternion(geometricQuaternion)) : null;
  const matrixProjection = matrixQuaternion ? projectionLength(new Vector3(1, 0, 0).applyQuaternion(matrixQuaternion)) : null;
  const disagreement = matrixQuaternion && geometricQuaternion ? degrees(matrixQuaternion.angleTo(geometricQuaternion)) : null;
  const inconsistent = signalsAgree && geometricProjection > 0.3 && matrixQuaternion
    && (disagreement > 35 || geometricProjection / Math.max(matrixProjection, 1e-6) > 1.5);
  const quaternion = inconsistent ? geometricQuaternion : matrixQuaternion ?? geometricQuaternion;
  // When the matrix disagrees, independent eye/cheek/temple axes estimate the
  // same cheek-width compensation. No anatomical ratio or mobile scale factor.
  const rigidProjections = axes.map(projectionLength).sort((a, b) => a - b);
  const robustProjection = rigidProjections.length ? rigidProjections[Math.floor(rigidProjections.length / 2)] : null;
  const euler = quaternion ? new Euler().setFromQuaternion(quaternion, "XYZ") : null;
  const angles = (q, prefix) => {
    const e = q ? new Euler().setFromQuaternion(q, "XYZ") : null;
    return { [`${prefix}Yaw`]: e ? degrees(e.y) : null, [`${prefix}Pitch`]: e ? degrees(e.x) : null,
      [`${prefix}Roll`]: e ? degrees(e.z) : null };
  };
  return { quaternion, geometricQuaternion, matrixQuaternion, inconsistent,
    correctionProjection: inconsistent ? robustProjection : null,
    metrics: { orientationSource: inconsistent ? "landmarks-consistency" : matrixQuaternion ? "matrix" : "landmarks",
      orientationDisagreementDegrees: disagreement, rigidSignalsAgree: signalsAgree,
      matrixProjectionLength: matrixProjection, geometricProjectionLength: geometricProjection,
      matrixCorrectionFactor: matrixProjection ? 1 / Math.max(0.35, matrixProjection) : null,
      ...angles(matrixQuaternion, "matrix"), ...angles(geometricQuaternion, "geometric"),
      rigidProjectionLengths: rigidProjections,
      rigidSpans: Object.fromEntries(pairs.map((v, i) => [["eyes", "cheeks", "temples"][i], {
        lengthPx: v.length(), projectionLength: v.length() > 1 ? projectionLength(v.clone().normalize()) : null,
      }])),
      yaw: euler ? degrees(euler.y) : null, pitch: euler ? degrees(euler.x) : null, roll: euler ? degrees(euler.z) : null } };
}
