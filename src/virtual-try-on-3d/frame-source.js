// One reusable drawing surface per tracking session. No crop, rotation or
// reflection: normalized landmarks remain in the original video coordinate space.
export function trackingDimensions(width, height, maxDimension = Infinity) {
  if (!(width > 0 && height > 0)) throw new Error("Invalid tracking source dimensions");
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export class TrackingFrameSource {
  constructor(createSurface = (w, h) => typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h })) {
    this.createSurface = createSurface; this.surface = null; this.context = null;
  }
  prepare(video, maxDimension = Infinity, forceSurface = false) {
    const sourceWidth = video.videoWidth ?? video.naturalWidth ?? video.width;
    const sourceHeight = video.videoHeight ?? video.naturalHeight ?? video.height;
    const size = trackingDimensions(sourceWidth, sourceHeight, maxDimension);
    let input = video;
    if (forceSurface || size.width !== sourceWidth || size.height !== sourceHeight) {
      if (!this.surface) {
        this.surface = this.createSurface(size.width, size.height);
        this.context = this.surface.getContext("2d", { alpha: false });
        if (!this.context) throw new Error("Tracking canvas unavailable");
      }
      if (this.surface.width !== size.width) this.surface.width = size.width;
      if (this.surface.height !== size.height) this.surface.height = size.height;
      this.context.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, size.width, size.height);
      input = this.surface;
    }
    return { input, sourceWidth, sourceHeight, trackingWidth: size.width, trackingHeight: size.height };
  }
  close() {
    if (this.surface) { this.surface.width = 1; this.surface.height = 1; }
    this.surface = this.context = null;
  }
}
