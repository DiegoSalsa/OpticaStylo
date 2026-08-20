export const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
export const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Recurso de muestra libre del pipeline. No representa un catálogo comercial.
export const DEMO_3D_GLASSES = Object.freeze({
  name: "Harley-Davidson HD0896",
  sku: "HD0896-001",
  modelUrl: "/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.glb",
  metadataUrl: "/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.tryon.json",
});

export const FACE_LANDMARK_INDICES = Object.freeze({
  LEFT_EYE_OUTER: 33,
  RIGHT_EYE_OUTER: 263,
  LEFT_EYE_INNER: 133,
  RIGHT_EYE_INNER: 362,
  NOSE_BRIDGE: 6,
  NOSE_TIP: 1,
  FOREHEAD: 10,
  CHIN: 152,
  LEFT_EAR: 234,
  RIGHT_EAR: 454,
  LEFT_TEMPLE: 127,
  RIGHT_TEMPLE: 356,
});
