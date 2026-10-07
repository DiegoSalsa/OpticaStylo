import { createFaceTrackingOnThread } from "./face-tracking-core.js";

let tracking = null;
globalThis.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      tracking = await createFaceTrackingOnThread("VIDEO");
      globalThis.postMessage({ faceMeshTriangleIndices: tracking.faceMeshTriangleIndices });
    } else if (data.type === "frame") {
      try {
        const started = performance.now();
        const result = tracking.landmarker.detectForVideo(data.bitmap, data.timestamp);
        globalThis.postMessage({ timestamp: data.timestamp,
          result: { ...result, inferenceDurationMs: performance.now() - started } });
      } finally { data.bitmap.close(); }
    }
  } catch (error) {
    globalThis.postMessage({ timestamp: data.timestamp, error: error.message });
  }
};
