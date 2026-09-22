import { createHash } from "node:crypto";
// Lógica del probador virtual 3D y sus contratos de datos.

import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  TRY_ON_MODEL_SCHEMA_VERSION,
  validateTryOnModelMetadata,
} from "./model-contract.js";

const ROLE_PATTERNS = Object.freeze({
  bridge: [/^bridge$/i, /integrated[_-]?bridge/i],
  front: [/^frame[_-]?front$/i, /frame[_-]?rim/i, /integrated[_-]?bridge/i],
  hingeLeft: [/hinge.*(?:_l(?:_|$)|left)/i],
  hingeRight: [/hinge.*(?:_r(?:_|$)|right)/i],
  lensLeft: [/lens.*(?:_l(?:_|$)|left)/i],
  lensRight: [/lens.*(?:_r(?:_|$)|right)/i],
  nosepadLeft: [/nosepad.*(?:_l(?:_|$)|left)/i],
  nosepadRight: [/nosepad.*(?:_r(?:_|$)|right)/i],
  templeLeft: [/temple.*(?:_l(?:_|$)|left)/i],
  templeRight: [/temple.*(?:_r(?:_|$)|right)/i],
});

// Validar y normalizar parse glb antes de continuar con la operación
function parseGlb(data) {
  if (typeof globalThis.ProgressEvent === "undefined") {
    globalThis.ProgressEvent = class ProgressEvent {};
  }
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
  });
}

// Centralizar la lógica de union bounds para mantener consistente el comportamiento de la aplicación
function unionBounds(items) {
  const bounds = new Box3();
  bounds.makeEmpty();
  for (const item of items) bounds.union(item.bounds);
  return bounds;
}

// Centralizar la lógica de box center para mantener consistente el comportamiento de la aplicación
function boxCenter(bounds) {
  return bounds.getCenter(new Vector3()).toArray();
}

// Centralizar la lógica de box size para mantener consistente el comportamiento de la aplicación
function boxSize(bounds) {
  return bounds.getSize(new Vector3()).toArray();
}

// Centralizar la lógica de matches rol para mantener consistente el comportamiento de la aplicación
function matchesRole(name, role) {
  return ROLE_PATTERNS[role].some((pattern) => pattern.test(name));
}

// Centralizar la lógica de classify meshes para mantener consistente el comportamiento de la aplicación
function classifyMeshes(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push({
      bounds: new Box3().setFromObject(object),
      name: object.name || `unnamed_mesh_${meshes.length + 1}`,
    });
  });
  const roles = {};
  for (const role of Object.keys(ROLE_PATTERNS)) {
    roles[role] = meshes.filter((mesh) => matchesRole(mesh.name, role));
  }
  return { meshes, roles };
}

// Centralizar la lógica de infer millimeters per unit para mantener consistente el comportamiento de la aplicación
function inferMillimetersPerUnit(rawWidth) {
  if (rawWidth >= 0.03 && rawWidth <= 0.5) return 1000;
  if (rawWidth >= 30 && rawWidth <= 500) return 1;
  return null;
}

// Centralizar la lógica de average para mantener consistente el comportamiento de la aplicación
function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Centralizar la lógica de measured lente width para mantener consistente el comportamiento de la aplicación
function measuredLensWidth(roles, millimetersPerUnit) {
  const widths = [...roles.lensLeft, ...roles.lensRight]
    .map((mesh) => boxSize(mesh.bounds)[0] * millimetersPerUnit)
    .filter((value) => value > 0);
  return widths.length > 0 ? average(widths) : null;
}

// Centralizar la lógica de measured bridge width para mantener consistente el comportamiento de la aplicación
function measuredBridgeWidth(roles, millimetersPerUnit) {
  if (roles.lensLeft.length === 0 || roles.lensRight.length === 0) return null;
  const first = unionBounds(roles.lensLeft);
  const second = unionBounds(roles.lensRight);
  const left = first.getCenter(new Vector3()).x < second.getCenter(new Vector3()).x
    ? first
    : second;
  const right = left === first ? second : first;
  const gap = (right.min.x - left.max.x) * millimetersPerUnit;
  return gap > 0 ? gap : null;
}

// Centralizar la lógica de measured temple length para mantener consistente el comportamiento de la aplicación
function measuredTempleLength(roles, millimetersPerUnit) {
  const lengths = [...roles.templeLeft, ...roles.templeRight]
    .map((mesh) => boxSize(mesh.bounds)[2] * millimetersPerUnit)
    .filter((value) => value > 0);
  return lengths.length > 0 ? average(lengths) : null;
}

// Centralizar la lógica de rol names para mantener consistente el comportamiento de la aplicación
function roleNames(roles, role) {
  return roles[role].map((item) => item.name);
}

// Centralizar la lógica de projected depth para mantener consistente el comportamiento de la aplicación
function projectedDepth(bounds, originDepth, direction) {
  const first = direction * (bounds.min.z - originDepth);
  const second = direction * (bounds.max.z - originDepth);
  return [Math.min(first, second), Math.max(first, second)];
}

// Centralizar la lógica de rounded para mantener consistente el comportamiento de la aplicación
function rounded(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

// Centralizar la lógica de rounded vector para mantener consistente el comportamiento de la aplicación
function roundedVector(values) {
  return values.map((value) => rounded(value));
}

/**
 * Analiza un GLB una vez durante su incorporación y devuelve el archivo auxiliar
 * seguro para el navegador que consume el probador. Los modelos ambiguos se marcan para revisión
 * en lugar de aceptarse de forma silenciosa.
 */
export async function analyzeTryOnGlb({ data, dimensionsMm = {}, identity }) {
  if (!data || !identity) throw new TypeError("data e identity son obligatorios.");
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const gltf = await parseGlb(bytes);
  const { meshes, roles } = classifyMeshes(gltf.scene);
  if (meshes.length === 0) throw new TypeError("El GLB no contiene mallas.");

  const warnings = [];
  for (const role of ["front", "bridge", "hingeLeft", "hingeRight", "templeLeft", "templeRight"]) {
    if (roles[role].length === 0) warnings.push(`No se detectó el rol ${role}.`);
  }

  const fullBounds = unionBounds(meshes);
  const fullSize = boxSize(fullBounds);
  const frontBounds = roles.front.length > 0 ? unionBounds(roles.front) : fullBounds;
  const templeItems = [...roles.templeLeft, ...roles.templeRight];
  const templeBounds = templeItems.length > 0 ? unionBounds(templeItems) : fullBounds;

  const dimensionsRanked = fullSize
    .map((size, axis) => ({ axis, size }))
    .sort((left, right) => right.size - left.size);
  const frontSize = boxSize(frontBounds);
  const widthAxis = frontSize.indexOf(Math.max(...frontSize));
  const templeSize = boxSize(templeBounds);
  const depthAxis = templeSize.indexOf(Math.max(...templeSize));
  const axesAreStandard = widthAxis === 0 && depthAxis === 2 && dimensionsRanked[2].axis === 1;
  if (!axesAreStandard) {
    warnings.push("Los ejes no siguen X=ancho, Y=alto, Z=profundidad; requiere normalización manual.");
  }

  const sourceWidthRaw = fullSize[0];
  const inferredMillimetersPerUnit = inferMillimetersPerUnit(sourceWidthRaw);
  if (!inferredMillimetersPerUnit && !dimensionsMm.frameWidth) {
    warnings.push("No fue posible inferir las unidades físicas del GLB.");
  }
  const millimetersPerUnit = dimensionsMm.frameWidth
    ? dimensionsMm.frameWidth / sourceWidthRaw
    : inferredMillimetersPerUnit;
  if (!millimetersPerUnit) throw new TypeError("Debe indicar dimensionsMm.frameWidth.");

  const fitOrigin = [
    fullBounds.getCenter(new Vector3()).x,
    frontBounds.getCenter(new Vector3()).y,
    frontBounds.min.z,
  ];
  const templeCenterDepth = templeBounds.getCenter(new Vector3()).z;
  const frontCenterDepth = frontBounds.getCenter(new Vector3()).z;
  const templeDirection = templeCenterDepth >= frontCenterDepth ? 1 : -1;
  const [, frontDepthRaw] = projectedDepth(frontBounds, fitOrigin[2], templeDirection);
  const [templeStartRaw] = projectedDepth(templeBounds, fitOrigin[2], templeDirection);
  const frontDepthMm = Math.max(0.001, frontDepthRaw * millimetersPerUnit);
  const templeStartDepthMm = templeStartRaw * millimetersPerUnit;
  if (templeStartDepthMm <= frontDepthMm) {
    warnings.push("No existe separación confiable entre el frente y las patillas.");
  }
  const safeTempleStartDepthMm = Math.max(frontDepthMm + 0.002, templeStartDepthMm);
  const maskFrontDepthMm = (frontDepthMm + safeTempleStartDepthMm) / 2;

  const bridgeBounds = roles.bridge.length > 0 ? unionBounds(roles.bridge) : frontBounds;
  const hingeLeftBounds = roles.hingeLeft.length > 0
    ? unionBounds(roles.hingeLeft)
    : frontBounds;
  const hingeRightBounds = roles.hingeRight.length > 0
    ? unionBounds(roles.hingeRight)
    : frontBounds;

  const metadata = {
    analysis: {
      confidence: rounded(Math.max(0, 1 - warnings.length * 0.15), 3),
      status: warnings.length === 0 ? "valid" : "review_required",
      warnings,
    },
    anchorsRaw: {
      bridge: roundedVector(boxCenter(bridgeBounds)),
      fitOrigin: roundedVector(fitOrigin),
      hingeLeft: roundedVector(boxCenter(hingeLeftBounds)),
      hingeRight: roundedVector(boxCenter(hingeRightBounds)),
    },
    dimensionsMm: {
      bridgeWidth: rounded(dimensionsMm.bridgeWidth
        ?? measuredBridgeWidth(roles, millimetersPerUnit)
        ?? 1),
      frameWidth: rounded(dimensionsMm.frameWidth ?? sourceWidthRaw * millimetersPerUnit),
      lensWidth: rounded(dimensionsMm.lensWidth
        ?? measuredLensWidth(roles, millimetersPerUnit)
        ?? 1),
      templeLength: rounded(dimensionsMm.templeLength
        ?? measuredTempleLength(roles, millimetersPerUnit)
        ?? 1),
    },
    fitting: {
      verticalOffsetMm: dimensionsMm.verticalOffsetMm ?? 2,
    },
    identity: {
      modelId: identity.modelId,
      name: identity.name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sku: identity.sku,
      sourceFilename: identity.sourceFilename,
    },
    nodes: {
      bridge: roleNames(roles, "bridge"),
      front: roleNames(roles, "front"),
      hingeLeft: roleNames(roles, "hingeLeft"),
      hingeRight: roleNames(roles, "hingeRight"),
      lensLeft: roleNames(roles, "lensLeft"),
      lensRight: roleNames(roles, "lensRight"),
      nosepadLeft: roleNames(roles, "nosepadLeft"),
      nosepadRight: roleNames(roles, "nosepadRight"),
      templeLeft: roleNames(roles, "templeLeft"),
      templeRight: roleNames(roles, "templeRight"),
    },
    normalization: {
      axisConvention: "X_RIGHT_Y_UP_Z_BACK",
      millimetersPerUnit: rounded(millimetersPerUnit),
      modelYawOffsetDegrees: templeDirection > 0 ? 180 : 0,
      offsetRaw: roundedVector(fitOrigin.map((value) => -value)),
    },
    occlusion: {
      frontDepthMm: rounded(frontDepthMm),
      maskFrontDepthMm: rounded(maskFrontDepthMm),
      templeStartDepthMm: rounded(safeTempleStartDepthMm),
    },
    schemaVersion: TRY_ON_MODEL_SCHEMA_VERSION,
  };

  return validateTryOnModelMetadata(metadata);
}
