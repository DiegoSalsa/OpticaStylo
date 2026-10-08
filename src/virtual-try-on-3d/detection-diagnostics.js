export function createDetectionDiagnostics() {
  return { inferenceAttempts: 0, inferencesCompleted: 0, inferencesWithFace: 0, inferencesWithoutFace: 0,
    mediaPipeErrors: 0, poseConversionRejections: 0, poseConversionErrors: 0, trackingInitializationErrors: 0 };
}

export function recordDetectionResult(counters, { result = null, inferenceError = null, pose = null, poseError = null }) {
  if (inferenceError) { counters.mediaPipeErrors++; counters.lastMediaPipeError = inferenceError.message; return; }
  if (!result) return;
  counters.inferencesCompleted++;
  if (!result.faceLandmarks?.[0]?.length) counters.inferencesWithoutFace++;
  else {
    counters.inferencesWithFace++;
    if (!pose) counters.poseConversionRejections++;
    if (poseError) { counters.poseConversionErrors++; counters.lastPoseConversionError = poseError.message; }
  }
}
