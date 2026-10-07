import { coverRectangle } from "./camera-projection.js";

// The existing single-column breakpoint also applies to touch-only phones and
// tablets after rotation, when their viewport can become wider than 780px.
export const COMPACT_CAMERA_MEDIA_QUERY = "(max-width: 780px), (pointer: coarse) and (hover: none)";

export function mediaRectangle(viewerWidth, viewerHeight, sourceAspect, fitMode) {
  if (!["cover", "contain"].includes(fitMode)) throw new TypeError("Modo de encuadre inválido.");
  if (![viewerWidth, viewerHeight, sourceAspect].every((n) => Number.isFinite(n) && n > 0)) {
    return { width: 0, height: 0, left: 0, top: 0 };
  }
  // Keep the approved desktop calculation byte-for-byte in its original module.
  if (fitMode === "cover") return coverRectangle(viewerWidth, viewerHeight, sourceAspect);
  const width = Math.min(viewerWidth, viewerHeight * sourceAspect);
  const height = width / sourceAspect;
  return { width, height, left: (viewerWidth - width) / 2, top: (viewerHeight - height) / 2 };
}
