export const TEMPLE_CLEARANCE_MM = 1;
export const MAX_TEMPLE_OPENING_RADIANS = 0.35; // 20°: avoid pretending any frame fits any head.
const BEND_TRANSITION_MM = 12;

/** Smooth hinge-preserving splay. CPU solver and vertex shader use this same
 * distance law: d²/(d+transition). No displacement at or ahead of hinge. */
export function templeDisplacement(distanceMm, radians) {
  const d = Math.max(0, distanceMm);
  return Math.tan(radians) * d * d / (d + BEND_TRANSITION_MM);
}

export function ellipsoidValue(point, proxy, margin = TEMPLE_CLEARANCE_MM) {
  return point.reduce((sum, n, i) => sum + ((n - proxy.center[i]) / (proxy.radii[i] + margin)) ** 2, 0);
}

export function fitTemple({ hinge, samples, cells = [], proxy, target, side }) {
  let requiredSlope = 0;
  for (const cell of cells) {
    // Conservative interval bound: largest ellipsoid cross-section within the
    // cell, closest inside surface and smallest bend lever. This bounds every
    // vertex in the cell, including vertices between the sampled depth slices.
    const closest = (i) => Math.max(cell.min[i], Math.min(cell.max[i], proxy.center[i]));
    const y = (closest(1) - proxy.center[1]) / (proxy.radii[1] + TEMPLE_CLEARANCE_MM);
    const z = (closest(2) - proxy.center[2]) / (proxy.radii[2] + TEMPLE_CLEARANCE_MM);
    const interior = 1 - y * y - z * z;
    const d = Math.max(0, hinge[2] - cell.max[2]), lever = d * d / (d + BEND_TRANSITION_MM);
    const insideX = side < 0 ? cell.max[0] : cell.min[0];
    if (interior > 0 && lever > 0.01) {
      const surfaceX = proxy.center[0] + side * (proxy.radii[0] + TEMPLE_CLEARANCE_MM) * Math.sqrt(interior);
      requiredSlope = Math.max(requiredSlope, side * (surfaceX - insideX) / lever);
    }
  }
  for (const point of samples) {
    const d = Math.max(0, hinge[2] - point[2]), lever = d * d / (d + BEND_TRANSITION_MM);
    const y = (point[1] - proxy.center[1]) / (proxy.radii[1] + TEMPLE_CLEARANCE_MM);
    const z = (point[2] - proxy.center[2]) / (proxy.radii[2] + TEMPLE_CLEARANCE_MM);
    const interior = 1 - y * y - z * z;
    if (interior <= 0 || lever < 0.01) continue;
    const surfaceX = proxy.center[0] + side * (proxy.radii[0] + TEMPLE_CLEARANCE_MM) * Math.sqrt(interior);
    requiredSlope = Math.max(requiredSlope, side * (surfaceX - point[0]) / lever);
  }
  if (target) {
    const d = Math.max(1, hinge[2] - target[2]);
    requiredSlope = Math.max(requiredSlope, Math.max(0, side * (target[0] - hinge[0])) / d);
  }
  const required = Math.atan(Math.max(0, requiredSlope));
  const bendRadians = Math.min(MAX_TEMPLE_OPENING_RADIANS, required);
  let minimumClearance = Infinity;
  for (const point of samples) {
    const deformed = [point[0] + side * templeDisplacement(hinge[2] - point[2], bendRadians), point[1], point[2]];
    minimumClearance = Math.min(minimumClearance, ellipsoidValue(deformed, proxy));
  }
  return { bendRadians, constrained: required > MAX_TEMPLE_OPENING_RADIANS || minimumClearance < 1 - 1e-6,
    minimumProxyValue: minimumClearance, hinge, side };
}

export function fitTemples(metadata, proxy, targets) {
  const result = { proxy };
  for (const [side, sign] of [["left", -1], ["right", 1]]) {
    const hinge = metadata.anchors[`hinge${side === "left" ? "Left" : "Right"}`].position;
    const samples = metadata.temples?.[side]?.samplesMm ?? Array.from({ length: 16 }, (_, i) => [hinge[0], hinge[1], hinge[2] - (i + 1) * 8]);
    result[side] = metadata.capabilities.templeBending ? fitTemple({ hinge, samples, cells: metadata.temples?.[side]?.cellsMm, proxy, target: targets[side], side: sign })
      : { bendRadians: 0, constrained: false, minimumProxyValue: null, hinge, side: sign };
  }
  return result;
}

export const TEMPLE_BEND_TRANSITION_MM = BEND_TRANSITION_MM;
