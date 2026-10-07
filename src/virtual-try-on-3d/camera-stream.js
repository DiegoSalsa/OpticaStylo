export function cameraStreamConstraints(facingMode, compactLayout, supported = {}) {
  const video = {
    facingMode: { ideal: facingMode },
    width: { ideal: 1280 },
    frameRate: { ideal: 60, max: 60 },
  };
  if (compactLayout) {
    // A width preference leaves height/aspect free to follow the native sensor.
    // Only request the standard no-resampling preference when supported; it is
    // ideal, never mandatory, and does not depend on a browser/device name.
    if (supported.resizeMode) video.resizeMode = { ideal: "none" };
  } else {
    video.height = { ideal: 720 };
    video.aspectRatio = { ideal: 16 / 9 };
  }
  return { audio: false, video };
}

function trackDictionary(track, method) {
  try {
    const value = track?.[method]?.();
    if (!value) return null;
    // Device identifiers are irrelevant to framing and need not be shared when
    // copying a debug report. All camera parameters remain available.
    const { deviceId: _deviceId, groupId: _groupId, ...parameters } = value;
    return parameters;
  } catch {
    return null; // Optional APIs may be missing or unavailable on Safari/devices.
  }
}

export function cameraStreamDiagnostics(video, track, requestedConstraints) {
  const settings = trackDictionary(track, "getSettings");
  const capabilities = trackDictionary(track, "getCapabilities");
  const videoWidth = video?.videoWidth ?? 0;
  const videoHeight = video?.videoHeight ?? 0;
  return {
    requestedConstraints: requestedConstraints ?? null,
    videoWidth,
    videoHeight,
    videoAspectRatio: videoHeight > 0 ? videoWidth / videoHeight : null,
    actualFacingMode: settings?.facingMode ?? null,
    settings,
    capabilities,
    zoom: {
      current: settings?.zoom ?? null,
      min: capabilities?.zoom?.min ?? null,
      max: capabilities?.zoom?.max ?? null,
    },
  };
}
