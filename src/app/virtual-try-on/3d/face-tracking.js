import { createFaceTrackingOnThread } from "./face-tracking-core.js";
import { TrackingSurface } from "@/virtual-try-on-3d/tracking-surface";

export async function createFaceTracking(runningMode = "VIDEO", { preferWorker = true } = {}) {
  if (runningMode === "VIDEO" && preferWorker && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    let worker;
    try {
      worker = new Worker(new URL("./face-tracking.worker.js", import.meta.url), { type: "module" });
      const ready = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Tracking worker timeout")), 12000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timeout);
          if (data.error) reject(new Error(data.error)); else resolve(data);
        };
        worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
        worker.postMessage({ type: "init" });
      });
      let pending = null, closed = false, busy = false;
      const surface = new TrackingSurface();
      worker.onmessage = ({ data }) => {
        if (!pending || pending.timestamp !== data.timestamp) return;
        const task = pending; pending = null; busy = false;
        if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
      };
      worker.onerror = (event) => {
        pending?.reject(new Error(event.message)); pending = null; busy = false; closed = true; worker.terminate(); surface.close();
      };
      return { faceMeshTriangleIndices: ready.faceMeshTriangleIndices, backend: "worker",
        landmarker: {
          async detectForVideo(video, timestamp, { maxDimension = Infinity } = {}) {
            if (closed || busy) throw new Error("Tracking session unavailable");
            busy = true;
            let bitmap, dimensions;
            const started = performance.now();
            try {
              let frame = surface.prepare(video, maxDimension);
              bitmap = await createImageBitmap(frame.input);
              // Some camera backends expose bitmap dimensions different from
              // videoWidth/videoHeight. Copy into the declared source space.
              if (bitmap.width !== frame.trackingWidth || bitmap.height !== frame.trackingHeight) {
                bitmap.close(); frame = surface.prepare(video, maxDimension, true);
                bitmap = await createImageBitmap(frame.input);
              }
              if (bitmap.width !== frame.trackingWidth || bitmap.height !== frame.trackingHeight) {
                bitmap.close(); throw new Error("Tracking input dimensions mismatch");
              }
              dimensions = { sourceWidth: frame.sourceWidth, sourceHeight: frame.sourceHeight,
                trackingWidth: bitmap.width, trackingHeight: bitmap.height, preprocessingMs: performance.now() - started };
            }
            catch (error) { busy = false; throw error; }
            if (closed) { bitmap.close(); throw new Error("Tracking session closed"); }
            return new Promise((resolve, reject) => {
              const timeout = setTimeout(() => { pending = null; busy = false; closed = true; worker.terminate(); surface.close(); reject(new Error("Inference timeout")); }, 3000);
              pending = { timestamp, resolve: (r) => { clearTimeout(timeout); resolve({ ...r, ...dimensions }); }, reject: (e) => { clearTimeout(timeout); reject(e); } };
              try { worker.postMessage({ type: "frame", bitmap, timestamp }, [bitmap]); }
              catch (error) { bitmap.close(); pending?.reject(error); pending = null; busy = false; }
            });
          },
          close() { closed = true; pending?.reject(new Error("Tracking closed")); pending = null; worker.terminate(); surface.close(); },
        } };
    } catch {
      worker?.terminate();
    }
  }
  const tracking = await createFaceTrackingOnThread(runningMode);
  if (runningMode !== "VIDEO") return { ...tracking, backend: "main-thread" };
  const surface = new TrackingSurface(), detector = tracking.landmarker;
  let closed = false;
  return { ...tracking, backend: "main-thread", landmarker: {
    detectForVideo(video, timestamp, { maxDimension = Infinity } = {}) {
      if (closed) throw new Error("Tracking session closed");
      const started = performance.now(), frame = surface.prepare(video, maxDimension), prepared = performance.now();
      const result = detector.detectForVideo(frame.input, timestamp);
      return { ...result, sourceWidth: frame.sourceWidth, sourceHeight: frame.sourceHeight,
        trackingWidth: frame.trackingWidth, trackingHeight: frame.trackingHeight,
        preprocessingMs: prepared - started, inferenceDurationMs: performance.now() - prepared };
    },
    close() { closed = true; surface.close(); detector.close(); },
  } };
}
