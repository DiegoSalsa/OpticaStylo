import { createFaceTrackingOnThread } from "./face-tracking-core.js";

export async function createFaceTracking(runningMode = "VIDEO") {
  if (runningMode === "VIDEO" && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
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
          async detectForVideo(video, timestamp) {
            if (closed || busy) throw new Error("Tracking session unavailable");
            busy = true;
            let bitmap;
            try { bitmap = await createImageBitmap(video); }
            catch (error) { busy = false; throw error; }
            if (closed) { bitmap.close(); throw new Error("Tracking session closed"); }
            return new Promise((resolve, reject) => {
              const timeout = setTimeout(() => { pending = null; busy = false; closed = true; worker.terminate(); reject(new Error("Inference timeout")); }, 3000);
              pending = { timestamp, resolve: (r) => { clearTimeout(timeout); resolve(r); }, reject: (e) => { clearTimeout(timeout); reject(e); } };
              try { worker.postMessage({ type: "frame", bitmap, timestamp }, [bitmap]); }
              catch (error) { bitmap.close(); pending?.reject(error); pending = null; busy = false; }
            });
          },
          close() { closed = true; pending?.reject(new Error("Tracking closed")); pending = null; worker.terminate(); },
        } };
    } catch {
      worker?.terminate();
    }
  }
  const tracking = await createFaceTrackingOnThread(runningMode);
  return { ...tracking, backend: "main-thread" };
}
