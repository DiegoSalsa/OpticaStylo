// Scale-only reference extracted from f06fa1317c4c1e3aa438f64dc0cdc30c5c4bd57d.
// Historical yaw clamping, two vertical diameters and 55/45 blending are
// intentional: the comparator must explain V1, not silently improve it.
export const REFERENCE_FACE_WIDTH_MM = 135;
export const AVERAGE_IRIS_DIAMETER_MM = 11.7;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function landmarkDistancePx(landmarks, first, second, width, height) {
  const a = landmarks?.[first], b = landmarks?.[second];
  return finite(a) && finite(b)
    ? Math.hypot((b.x - a.x) * width, (b.y - a.y) * height) : null;
}

function historicalYaw(landmarks, width, height, transform) {
  const eyeDistance = landmarkDistancePx(landmarks, 33, 263, width, height);
  const eyeCenterX = (2 - landmarks[33].x - landmarks[263].x) * width / 2;
  const noseDeviation = ((1 - landmarks[1].x) * width - eyeCenterX) / eyeDistance;
  const fallback = Math.asin(clamp(noseDeviation * 2.4, -0.72, 0.72));
  const data = transform?.data;
  if ((!Array.isArray(data) && !ArrayBuffer.isView(data)) || data.length !== 16) return fallback;
  const scaleX = Math.hypot(data[0], data[1], data[2]);
  const scaleY = Math.hypot(data[4], data[5], data[6]);
  const scaleZ = Math.hypot(data[8], data[9], data[10]);
  if (scaleX === 0 || scaleY === 0 || scaleZ === 0) return fallback;
  const yaw = Math.asin(clamp(data[8] / scaleZ, -1, 1));
  const distance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  return clamp(distance(yaw, fallback) <= distance(-yaw, fallback) ? yaw : -yaw, -1.05, 1.05);
}

export function historicalScale(landmarks, width, height, transform = null) {
  const projectedFaceWidthPx = landmarkDistancePx(landmarks, 234, 454, width, height);
  const yaw = historicalYaw(landmarks, width, height, transform);
  const v1FaceScalePxPerMm = projectedFaceWidthPx / Math.max(0.68, Math.cos(yaw)) / REFERENCE_FACE_WIDTH_MM;
  const diameters = [[470, 472], [475, 477]].map(([a, b]) => landmarkDistancePx(landmarks, a, b, width, height));
  const valid = diameters.filter((d) => d !== null && d >= 1.5);
  const v1IrisScalePxPerMm = valid.length
    ? valid.reduce((a, b) => a + b, 0) / valid.length / AVERAGE_IRIS_DIAMETER_MM : null;
  const bounded = v1IrisScalePxPerMm === null ? null
    : clamp(v1IrisScalePxPerMm, v1FaceScalePxPerMm * 0.72, v1FaceScalePxPerMm * 1.38);
  return { projectedFaceWidthPx, v1FaceScalePxPerMm, v1IrisScalePxPerMm,
    v1IrisDiameterPxLeft: diameters[1], v1IrisDiameterPxRight: diameters[0],
    irisDiameterPxLeft: diameters[1], irisDiameterPxRight: diameters[0],
    v1BlendedScalePxPerMm: bounded === null ? v1FaceScalePxPerMm
      : v1FaceScalePxPerMm * 0.55 + bounded * 0.45 };
}

/** Same facial sample, video dimensions and model. Widths are at the bridge
 * plane before perspective/rotation; they are not a rendered AABB or CSS px. */
export function compareScales(landmarks, width, height, transform, {
  unprojectedFaceWidthPx, projectionLength, correctedFaceWidthPx,
  frameWidthMm, scaleFactor = 1, referenceFaceWidthMm = REFERENCE_FACE_WIDTH_MM,
}) {
  const historical = historicalScale(landmarks, width, height, transform);
  const v2ScalePxPerMm = correctedFaceWidthPx / referenceFaceWidthMm;
  return { ...historical, unprojectedFaceWidthPx, projectionLength, correctedFaceWidthPx,
    videoWidth: width, videoHeight: height,
    irisDiametersPx: [[469, 471], [470, 472], [474, 476], [475, 477]]
      .map(([a, b]) => landmarkDistancePx(landmarks, a, b, width, height)),
    eyeOpeningPxRight: landmarkDistancePx(landmarks, 159, 145, width, height),
    eyeOpeningPxLeft: landmarkDistancePx(landmarks, 386, 374, width, height),
    irisScalePxPerMm: historical.v1IrisScalePxPerMm,
    v2ProjectedFaceScalePxPerMm: historical.projectedFaceWidthPx / referenceFaceWidthMm,
    v2FaceScalePxPerMm: unprojectedFaceWidthPx / referenceFaceWidthMm,
    v2ScalePxPerMm, ratioV2ToOld: v2ScalePxPerMm / historical.v1BlendedScalePxPerMm,
    frameWidthMm, scaleFactor,
    oldEstimatedFrameWidthPx: frameWidthMm * historical.v1BlendedScalePxPerMm * scaleFactor,
    v2EstimatedFrameWidthPx: frameWidthMm * v2ScalePxPerMm * scaleFactor };
}
