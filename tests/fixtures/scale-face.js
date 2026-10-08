import { faceLandmarks } from "./vto-fixtures.js";

// Deterministic facial/iris inputs, not measurements of a person. Facial
// anatomy and camera distance can vary independently; iris diameter is 11.7 mm.
export function scaleFace({ faceWidthMm = 155, pixelsPerMm = 2, ...motion } = {}) {
  const face = faceLandmarks({ ...motion, zoom: faceWidthMm * pixelsPerMm / 500 });
  const radius = 11.7 * pixelsPerMm / 2;
  for (const [center, a, b, c, d, x] of [[468, 469, 470, 471, 472, -45], [473, 474, 475, 476, 477, 45]]) {
    const point = (dx, dy) => ({ x: 0.5 + (x * pixelsPerMm + dx) / 1000,
      y: 0.4 + dy / 500, z: 0 });
    face.landmarks[center] = point(0, 0);
    face.landmarks[a] = point(radius, 0);
    face.landmarks[b] = point(0, -radius);
    face.landmarks[c] = point(-radius, 0);
    face.landmarks[d] = point(0, radius);
  }
  return face;
}
