export const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
export const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export const DEMO_VIRTUAL_FRAMES = Object.freeze([
  {
    assetId: "demo-round",
    imageUrl: "/virtual-try-on/frames/demo-round.svg",
    isDemo: true,
    name: "Clásico redondo",
    productId: null,
    rotationOffsetDegrees: 0,
    sku: "DEMO-ROUND",
    unitPriceCents: null,
    verticalOffset: 0.02,
    widthScale: 2.28,
  },
  {
    assetId: "demo-square",
    imageUrl: "/virtual-try-on/frames/demo-square.svg",
    isDemo: true,
    name: "Urbano rectangular",
    productId: null,
    rotationOffsetDegrees: 0,
    sku: "DEMO-SQUARE",
    unitPriceCents: null,
    verticalOffset: 0.015,
    widthScale: 2.38,
  },
  {
    assetId: "demo-cat-eye",
    imageUrl: "/virtual-try-on/frames/demo-cat-eye.svg",
    isDemo: true,
    name: "Cat eye burdeo",
    productId: null,
    rotationOffsetDegrees: 0,
    sku: "DEMO-CAT-EYE",
    unitPriceCents: null,
    verticalOffset: 0.005,
    widthScale: 2.3,
  },
]);

// ── 3D try-on ──────────────────────────────────────────────────────────

export const DEMO_3D_GLASSES = Object.freeze({
  name: "Harley-Davidson HD0896",
  sku: "HD0896-001",
  modelUrl: "/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.glb",
});

/** Default calibration for aligning the 3D model to face landmarks. */
export const DEFAULT_3D_CALIBRATION = Object.freeze({
  positionOffsetX: 0,
  positionOffsetY: 0.04,
  positionOffsetZ: 0,
  rotationOffsetX: 0,
  rotationOffsetY: 180,
  rotationOffsetZ: 0,
  widthScale: 2.28,
});

/**
 * Key MediaPipe Face Landmarker indices for 3D pose estimation.
 * @see https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
 */
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
});
