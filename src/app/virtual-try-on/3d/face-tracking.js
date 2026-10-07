import { createFaceTrackingOnThread } from "./face-tracking-core.js";
import { TrackingFrameSource } from "@/virtual-try-on-3d/frame-source";

export async function createFaceTracking(runningMode = "VIDEO", { preferWorker = true } = {}) {
  if (preferWorker && runningMode === "VIDEO" && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
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
      const frames = new TrackingFrameSource();
      worker.onmessage = ({ data }) => {
        if (!pending || pending.timestamp !== data.timestamp) return;
        const task = pending; pending = null; busy = false;
        if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
      };
      worker.onerror = (event) => {
        pending?.reject(new Error(event.message)); pending = null; busy = false; closed = true; worker.terminate();
      };
      return { faceMeshTriangleIndices: ready.faceMeshTriangleIndices, backend: "worker",
        landmarker: {
          async detectForVideo(video, timestamp, request) {
            if (closed || busy) throw new Error("Tracking session unavailable");
            busy = true;
            let bitmap, frame, bitmapDimensionCorrection = false;
            const preparing = performance.now();
            try {
              frame = frames.prepare(video, request?.maxDimension);
              bitmap = await createImageBitmap(frame.input);
              if (bitmap.width !== frame.trackingWidth || bitmap.height !== frame.trackingHeight) {
                // Test the actual decoded bitmap contract, including orientation.
                // The drawing surface bakes the same displayed video coordinates.
                bitmap.close(); bitmapDimensionCorrection = true;
                frame = frames.prepare(video, request?.maxDimension, true);
                bitmap = await createImageBitmap(frame.input);
                if (bitmap.width !== frame.trackingWidth || bitmap.height !== frame.trackingHeight) {
                  bitmap.close(); throw new Error("Tracking bitmap dimensions mismatch");
                }
              }
            }
            catch (error) { busy = false; throw error; }
            if (closed) { bitmap.close(); throw new Error("Tracking session closed"); }
            return new Promise((resolve, reject) => {
              const timeout = setTimeout(() => { pending = null; busy = false; closed = true; worker.terminate(); reject(new Error("Inference timeout")); }, 3000);
              const { input: _input, ...dimensions } = frame;
              const preprocessingMs = performance.now() - preparing;
              const bitmapWidth = bitmap.width, bitmapHeight = bitmap.height;
              pending = { timestamp, resolve: (r) => { clearTimeout(timeout); resolve({ ...r, ...dimensions, preprocessingMs,
                bitmapWidth, bitmapHeight, bitmapDimensionCorrection }); }, reject: (e) => { clearTimeout(timeout); reject(e); } };
              try { worker.postMessage({ type: "frame", bitmap, timestamp }, [bitmap]); }
              catch (error) { bitmap.close(); pending?.reject(error); pending = null; busy = false; }
            });
          },
          close() { closed = true; pending?.reject(new Error("Tracking closed")); pending = null; worker.terminate(); frames.close(); },
        } };
    } catch {
      worker?.terminate();
    }
  }
  const tracking = await createFaceTrackingOnThread(runningMode);
  if (runningMode === "VIDEO") {
    const sdk = tracking.landmarker, frames = new TrackingFrameSource();
    tracking.landmarker = {
      detectForVideo(video, timestamp, request) {
        const preparing = performance.now(), frame = frames.prepare(video, request?.maxDimension);
        const started = performance.now(), preprocessingMs = started - preparing;
        const result = sdk.detectForVideo(frame.input, timestamp);
        const { input: _input, ...dimensions } = frame;
        return { ...result, ...dimensions, preprocessingMs, inferenceDurationMs: performance.now() - started };
      },
      close() { sdk.close(); frames.close(); },
    };
  }
  return { ...tracking, backend: "main-thread" };
}
