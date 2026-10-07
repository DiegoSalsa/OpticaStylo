export function trackingSize(width, height, maxDimension = Infinity) {
  if (!(width > 0 && height > 0)) throw new Error("Invalid tracking source");
  const factor = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

/** One reusable surface. Full frame, no crop, no reflection. SDK output stays
 * normalized to this full image; reconstruction always uses source dimensions. */
export class TrackingSurface {
  constructor(createSurface = () => typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas")) {
    this.createSurface = createSurface; this.surface = null; this.context = null;
  }
  prepare(source, maxDimension = Infinity, forceSurface = false) {
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    const size = trackingSize(sourceWidth, sourceHeight, maxDimension);
    let input = source;
    if (forceSurface || size.width !== sourceWidth || size.height !== sourceHeight) {
      if (!this.surface) { this.surface = this.createSurface(); this.context = this.surface.getContext("2d", { alpha: false }); }
      if (this.surface.width !== size.width) this.surface.width = size.width;
      if (this.surface.height !== size.height) this.surface.height = size.height;
      this.context.drawImage(source, 0, 0, size.width, size.height);
      input = this.surface;
    }
    return { input, sourceWidth, sourceHeight, trackingWidth: size.width, trackingHeight: size.height };
  }
  close() { if (this.surface) this.surface.width = this.surface.height = 1; this.surface = this.context = null; }
}
