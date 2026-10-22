import { createFaceTracking } from "./face-tracking.js";
import { createFaceTrackingOnThread } from "./face-tracking-core.js";

/** Un worker puede iniciar y fallar al transferir el primer bitmap. Degradar
 * una sola vez evita una sesión permanentemente cerrada y bucles de reintento. */
export async function createResilientFaceTracking(mode = "VIDEO") {
  let tracking = await createFaceTracking(mode), closed = false, fallbacks = 0;
  return {
    faceMeshTriangleIndices: tracking.faceMeshTriangleIndices,
    get backend() { return tracking.backend; },
    get fallbacks() { return fallbacks; },
    landmarker: {
      detect: (image) => tracking.landmarker.detect(image),
      async detectForVideo(video, timestamp) {
        try { return await tracking.landmarker.detectForVideo(video, timestamp); }
        catch (error) {
          if (closed || tracking.backend !== "worker" || fallbacks) throw error;
          fallbacks++; tracking.landmarker.close();
          const replacement = await createFaceTrackingOnThread("VIDEO");
          if (closed) { replacement.landmarker.close(); throw error; }
          tracking = { ...replacement, backend: "main-thread" };
          // La medición fallida no se reprocesa con otro frame y timestamp viejo.
          throw error;
        }
      },
      close() { closed = true; tracking.landmarker.close(); },
    },
  };
}
