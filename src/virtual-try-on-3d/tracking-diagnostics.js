// Worker SDK execution is reported by the worker itself. Main-thread SDK calls
// are synchronous: measure the invocation separately from awaiting its result.
export async function measureVideoInference(landmarker, video, timestamp, clock = () => performance.now()) {
  const started = clock();
  const pending = landmarker.detectForVideo(video, timestamp);
  const synchronousCallMs = clock() - started;
  const result = await pending;
  return { result, sdkExecutionTimeMs: result?.inferenceDurationMs ?? synchronousCallMs };
}

export class TrackingDiagnostics {
  constructor() {
    this.values = { inferenceCount: 0, faceResultCount: 0, noFaceResultCount: 0,
      poseConversionRejectedCount: 0, inferenceErrorCount: 0, discardedResultCount: 0,
      poseRejectReason: null, sdkExecutionTimeMs: 0, inferenceDurationMs: 0,
      smoothedInferenceDurationMs: 0, totalProcessingTimeMs: 0 };
    this.lastResultHadFace = false;
  }
  recordInference(result, error, sdkExecutionTimeMs) {
    const v = this.values;
    v.inferenceCount++;
    this.lastResultHadFace = Boolean(result?.faceLandmarks?.length);
    if (error) { v.inferenceErrorCount++; v.poseRejectReason = "inference-error"; }
    else if (this.lastResultHadFace) { v.faceResultCount++; v.poseRejectReason = null; }
    else { v.noFaceResultCount++; v.poseRejectReason = "no-landmarks"; }
    v.sdkExecutionTimeMs = v.inferenceDurationMs = sdkExecutionTimeMs;
    v.smoothedInferenceDurationMs = v.smoothedInferenceDurationMs
      ? v.smoothedInferenceDurationMs * 0.8 + sdkExecutionTimeMs * 0.2 : sdkExecutionTimeMs;
  }
  recordPose(pose, reason) {
    if (this.lastResultHadFace && !pose) {
      this.values.poseConversionRejectedCount++;
      this.values.poseRejectReason = reason ?? "pose-null";
    }
  }
  metrics(filterMetrics) {
    return { ...this.values, ...filterMetrics,
      poseRejectedCount: this.values.poseConversionRejectedCount + filterMetrics.poseFilterRejectedCount,
      poseRejectReason: filterMetrics.poseFilterRejectReason ?? this.values.poseRejectReason };
  }
}
