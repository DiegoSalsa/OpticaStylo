import { coverRectangle } from "./camera-projection.js";

/** Describes presentation crop, not sensor crop. MediaPipe always uses the
 * full source-video coordinates. A mobile viewer fits sourceAspect at full
 * available width; desktop retains its approved cover rectangle. */
export function framePresentation(sourceWidth, sourceHeight, viewerWidth, viewerHeight) {
  if (![sourceWidth, sourceHeight, viewerWidth, viewerHeight].every((n) => Number.isFinite(n) && n > 0)) return null;
  const sourceAspect = sourceWidth / sourceHeight, viewerAspect = viewerWidth / viewerHeight;
  const media = coverRectangle(viewerWidth, viewerHeight, sourceAspect);
  const cssPixelsPerSourcePixel = media.width / sourceWidth;
  const visibleSource = { x: Math.max(0, -media.left / cssPixelsPerSourcePixel),
    y: Math.max(0, -media.top / cssPixelsPerSourcePixel),
    width: Math.min(sourceWidth, viewerWidth / cssPixelsPerSourcePixel),
    height: Math.min(sourceHeight, viewerHeight / cssPixelsPerSourcePixel) };
  const visibleFraction = visibleSource.width * visibleSource.height / (sourceWidth * sourceHeight);
  return { sourceWidth, sourceHeight, sourceAspect, viewerWidth, viewerHeight, viewerAspect, media,
    cssPixelsPerSourcePixel, visibleSource, visibleFraction, croppedFraction: Math.max(0, 1 - visibleFraction),
    magnificationVsFullWidth: media.width / viewerWidth,
    fullFrameVisible: visibleFraction >= 1 - 0.002 };
}

export function mobileViewerDimensions(sourceWidth, sourceHeight, usefulWidth) {
  return { width: usefulWidth, height: usefulWidth * sourceHeight / sourceWidth };
}

// One operation sequence for the native camera or a local photograph; output
// stays in full source pixels, independent of CSS viewport and device DPR.
export function drawTryOnCapture(context, media, overlay, width, height, mirrored) {
  if (mirrored) { context.save(); context.translate(width, 0); context.scale(-1, 1); }
  context.drawImage(media, 0, 0, width, height);
  if (mirrored) context.restore();
  context.drawImage(overlay, 0, 0, width, height);
}
