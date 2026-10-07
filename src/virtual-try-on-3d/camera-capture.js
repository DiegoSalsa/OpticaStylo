export function cameraCaptureConstraints(compact, facingMode = "user") {
  return { audio: false, video: compact ? {
    facingMode: { ideal: facingMode }, width: { ideal: 960 }, frameRate: { ideal: 30, max: 30 },
  } : {
    facingMode: { ideal: facingMode }, aspectRatio: { ideal: 16 / 9 },
    height: { ideal: 720 }, width: { ideal: 1280 }, frameRate: { ideal: 60, max: 60 },
  } };
}
