// Browser cameras do not expose reliable intrinsics. fx=videoWidth is an
// explicit estimated focal (53.13° horizontal), replaceable by calibrated fx.
// On the bridge plane one world unit is one video pixel. z>0 faces the camera.
export function cameraProjection(width, height, focalPx = width) {
  return { focalPx, width, height, fovDegrees: 2 * Math.atan(height / (2 * focalPx)) * 180 / Math.PI,
    aspect: width / height, source: focalPx === width ? "estimated" : "calibrated" };
}

export function unprojectVideoPoint(x, y, relativeDepthPx, projection) {
  const z = Math.min(projection.focalPx * 0.8, relativeDepthPx);
  const ratio = (projection.focalPx - z) / projection.focalPx;
  return [(x - projection.width / 2) * ratio, (projection.height / 2 - y) * ratio, z];
}

export function coverRectangle(viewerWidth, viewerHeight, sourceAspect) {
  const width = Math.max(viewerWidth, viewerHeight * sourceAspect), height = width / sourceAspect;
  return { width, height, left: (viewerWidth - width) / 2, top: (viewerHeight - height) / 2 };
}
