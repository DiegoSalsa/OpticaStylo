const finite = (value) => Number.isFinite(value) ? value : null;
const pickNumbers = (object, keys) => Object.fromEntries(keys.map((key) => [key, finite(object?.[key])]));
const enumValue = (value, allowed) => allowed.includes(value) ? value : null;
const numericConstraint = (value) => typeof value === "number" ? finite(value)
  : pickNumbers(value, ["min", "max", "step", "ideal", "exact"]);

/** Lista permitida explícita: nunca copiar settings, errores, geometría facial,
 * URLs, identificadores ni objetos desconocidos al informe que sale del equipo. */
export function technicalReport(metrics, build = {}) {
  const camera = metrics.camera ?? {}, settings = camera.settings ?? {}, projection = metrics.projection ?? {};
  const presentation = metrics.presentation ?? {};
  return {
    schemaVersion: 1,
    build: { commit: /^[a-f0-9]{7,40}$/.test(build.commit) ? build.commit : null,
      branch: build.branch === "mejoras-probador" ? build.branch : null, dirty: build.dirty === true },
    ...pickNumbers(metrics, ["cameraFps", "inferenceFps", "renderFps", "processingMs", "inferenceMs",
      "approximateLatencyMs", "cameraReadyMs", "trackingInitializationMs", "firstPoseMs", "recoveryMs", "recoveries", "visualLosses",
      "droppedFrames", "rejectedStaleResults", "sourceResolutionChanges", "resultAgeMs", "deliveryAgeMs", "captureAgeBudgetMs",
      "pixelsPerMm", "finalScalePxPerMm", "frameWidthMm", "finalFrameWidthPx", "irisWeight", "irisConsistency",
      "irisAgeMs", "correctedFaceWidthPx", "irisScalePxPerMm", "v2ScalePxPerMm", "ratioCorrectedToOld", "backendFallbacks"]),
    backend: enumValue(metrics.backend, ["worker", "main-thread"]),
    trackingState: enumValue(metrics.trackingState, ["unacquired", "detected", "stable", "transient-loss", "lost", "recovering"]),
    modelVisible: metrics.modelVisible === true,
    scaleSource: enumValue(metrics.scaleSource, ["iris", "blend", "face", "iris-held", "face-transition", "blend-transition", "iris-transition", "historical", "v2", "stale-held"]),
    irisConfidence: enumValue(metrics.irisConfidence, ["high", "medium", "invalid"]),
    irisStable: metrics.irisStable === true,
    detection: pickNumbers(metrics.detection, ["inferenceAttempts", "inferencesCompleted", "inferencesWithFace", "inferencesWithoutFace",
      "mediaPipeErrors", "poseConversionRejections", "poseConversionErrors", "trackingInitializationErrors", "discardedResolutionChanges", "discardedStaleResults"]),
    camera: { ...pickNumbers(settings, ["width", "height", "frameRate", "aspectRatio", "zoom"]),
      videoWidth: finite(camera.videoWidth), videoHeight: finite(camera.videoHeight),
      requestedFacingMode: enumValue(camera.requestedFacingMode, ["user", "environment"]),
      actualFacingMode: enumValue(camera.actualFacingMode, ["user", "environment", "left", "right"]),
      resizeMode: enumValue(settings.resizeMode, ["none", "crop-and-scale"]),
      zoom: pickNumbers(camera.zoom, ["current", "min", "max", "step"]),
      supportedConstraints: Object.fromEntries(["width", "height", "frameRate", "aspectRatio", "facingMode", "zoom", "resizeMode"]
        .map((key) => [key, typeof camera.supportedConstraints?.[key] === "boolean" ? camera.supportedConstraints[key] : null])),
      capabilities: Object.fromEntries(["width", "height", "frameRate", "aspectRatio", "zoom"]
        .map((key) => [key, numericConstraint(camera.capabilities?.[key])])),
      appliedConstraints: Object.fromEntries(["width", "height", "frameRate", "aspectRatio", "zoom"]
        .map((key) => [key, numericConstraint(camera.appliedConstraints?.[key])])),
      capabilitiesAvailable: camera.capabilitiesAvailable === true,
      intrinsics: "unavailable" },
    projection: { ...pickNumbers(projection, ["width", "height", "focalPx", "fovDegrees", "aspect"]),
      source: enumValue(projection.source, ["estimated", "calibrated"]) },
    presentation: { ...pickNumbers(presentation, ["sourceWidth", "sourceHeight", "viewerWidth", "viewerHeight", "visibleFraction", "alignmentErrorPx"]),
      video: pickNumbers(presentation.videoRectangle, ["width", "height"]),
      canvas: pickNumbers(presentation.canvasRectangle, ["width", "height"]) },
    measurementNotes: { fps: "measured", scale: "estimated-population-reference", focal: "estimated-not-camera-intrinsics",
      missingValues: "unavailable", confidence: "geometric-consistency-not-probability" },
  };
}
