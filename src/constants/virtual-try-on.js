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
