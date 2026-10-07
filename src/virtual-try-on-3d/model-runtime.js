import { Matrix4, Vector3 } from "three";

export function canonicalModelMatrix(metadata) {
  if (metadata.schemaVersion === 2) return new Matrix4().fromArray(metadata.normalization.canonicalFromSource);
  // V1 compatibility adapter: legacy orientation is applied once to geometry,
  // never mixed into head yaw. The actual bridge is the new pivot.
  return new Matrix4().makeRotationY(metadata.normalization.modelYawOffsetDegrees * Math.PI / 180)
    .multiply(new Matrix4().makeScale(...Array(3).fill(metadata.normalization.millimetersPerUnit)))
    .multiply(new Matrix4().makeTranslation(...metadata.anchorsRaw.bridge.map((n) => -n)));
}

export function runtimeFittingMetadata(metadata) {
  if (metadata.schemaVersion === 2) return metadata;
  const matrix = canonicalModelMatrix(metadata);
  const anchors = {};
  for (const side of ["Left", "Right"]) {
    anchors[`hinge${side}`] = { position: new Vector3().fromArray(metadata.anchorsRaw[`hinge${side}`]).applyMatrix4(matrix).toArray() };
  }
  // Reassign sides geometrically: legacy side names can be reversed by yaw.
  if (anchors.hingeLeft.position[0] > anchors.hingeRight.position[0]) [anchors.hingeLeft, anchors.hingeRight] = [anchors.hingeRight, anchors.hingeLeft];
  return { ...metadata, anchors, capabilities: { templeBending: true }, temples: null };
}
