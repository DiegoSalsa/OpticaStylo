import {
  FACE_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_URL,
} from "@/constants/virtual-try-on";
import { withMediaPipeConsoleFilter } from "@/utils/mediapipe-console";

async function createFaceTrackingInternal(runningMode) {
  const { FaceLandmarker, FilesetResolver } =
    await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const commonOptions = {
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    numFaces: 1,
    runningMode,
  };

  let tracking = null;
  let lastError = null;
  const attempts = [{ delegate: "GPU" }, { delegate: null }];
  for (const attempt of attempts) {
    try {
      const baseOptions = { modelAssetPath: FACE_LANDMARKER_MODEL_URL };
      if (attempt.delegate) baseOptions.delegate = attempt.delegate;
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions,
        outputFacialTransformationMatrixes: true,
      });
      tracking = { landmarker };
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!tracking) {
    throw lastError ?? new Error("No se pudo iniciar el seguimiento facial.");
  }

  const faceMeshTriangleIndices =
    FaceLandmarker.FACE_LANDMARKS_TESSELATION.filter(
      (_, index) => index % 3 === 0,
    ).flatMap((edge, triangleIndex) => {
      const nextEdge =
        FaceLandmarker.FACE_LANDMARKS_TESSELATION[triangleIndex * 3 + 1];
      return [edge.start, edge.end, nextEdge.end];
    });
  return { faceMeshTriangleIndices, ...tracking };
}

export async function createFaceTracking(runningMode = "VIDEO") {
  return withMediaPipeConsoleFilter(() =>
    createFaceTrackingInternal(runningMode),
  );
}
