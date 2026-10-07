// All timestamps use performance.now() milliseconds. Video mediaTime is used
// only to identify frames; mixing its clock with RAF makes result ages meaningless.
export class TrackingTimeline {
  constructor(computeHeadroom = 1.15) { this.computeHeadroom = computeHeadroom; this.reset(); }
  reset() {
    this.inFlight = false; this.lastMediaTime = -1; this.lastStarted = -Infinity;
    this.lastAccepted = -Infinity; this.durationMs = 0; this.intervalMs = 0;
    this.cameraFrames = 0; this.inferences = 0; this.dropped = 0;
  }
  observe(mediaTime) {
    if (!Number.isFinite(mediaTime) || mediaTime <= this.lastMediaTime) return false;
    this.lastMediaTime = mediaTime; this.cameraFrames++;
    return true;
  }
  begin(timestamp, minIntervalMs = 0) {
    if (this.inFlight || timestamp <= this.lastStarted || timestamp - this.lastStarted < Math.max(this.intervalMs, minIntervalMs)) {
      this.dropped++; return false;
    }
    this.inFlight = true; this.lastStarted = timestamp; return true;
  }
  finish(timestamp, durationMs) {
    if (!this.inFlight || timestamp !== this.lastStarted) { this.dropped++; return false; }
    this.inFlight = false; this.inferences++;
    this.durationMs = this.durationMs ? this.durationMs * 0.8 + durationMs * 0.2 : durationMs;
    // Leave compute headroom on fallback devices; worker can use every real frame
    // when inference is cheap. No backlog and no fixed 25 Hz ceiling.
    this.intervalMs = this.durationMs * this.computeHeadroom;
    if (timestamp <= this.lastAccepted) { this.dropped++; return false; }
    this.lastAccepted = timestamp; return true;
  }
}

export function startVideoFrameLoop(video, onFrame, environment = globalThis) {
  let active = true, handle = null;
  const rvfc = typeof video.requestVideoFrameCallback === "function";
  const schedule = () => {
    if (!active) return;
    handle = rvfc ? video.requestVideoFrameCallback(tick) : environment.requestAnimationFrame(tick);
  };
  const tick = (now, metadata) => {
    if (!active) return;
    if (video.readyState >= 2) onFrame(now, metadata?.mediaTime ?? video.currentTime,
      metadata?.captureTime ?? metadata?.expectedDisplayTime ?? now);
    schedule();
  };
  schedule();
  return () => {
    active = false;
    if (handle !== null) {
      if (rvfc) video.cancelVideoFrameCallback(handle);
      else environment.cancelAnimationFrame(handle);
    }
  };
}
