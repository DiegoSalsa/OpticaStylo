import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";

const face = JSON.parse(readFileSync(new URL("./canonical-face.json", import.meta.url)));
export function rebuildFace(width, height, { yaw = 0, pitch = 0, roll = 0 } = {}) {
  const points = face.vertices.map((p) => new Vector3().fromArray(p)), nose = points[6].clone();
  const factor = width * 0.25 / points[234].distanceTo(points[454]);
  const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll));
  const landmarks = points.map((point) => {
    const p = point.sub(nose).applyQuaternion(q).multiplyScalar(factor), perspective = width / (width - p.z);
    return { x: 0.5 + p.x * perspective / width, y: 0.5 - p.y * perspective / height, z: -p.z / width };
  });
  return { landmarks, transform: { data: new Matrix4().makeRotationFromQuaternion(q).toArray() } };
}

// All approved output fields, including the entire mask and temple fitting.
// New diagnostic fields cannot change this fingerprint.
export function desktopFingerprint(convert, metadata) {
  const poses = [];
  for (const yaw of [-0.785, -0.52, 0, 0.52, 0.785]) for (const pitch of [-0.3, 0, 0.3]) for (const mirrored of [false, true]) {
    const f = rebuildFace(1280, 720, { yaw, pitch, roll: 0.08 });
    const p = convert(f.landmarks, 1280, 720, metadata, f.transform, { mirrored });
    const { diagnostics: _diagnostics, ...approved } = p;
    poses.push(approved);
  }
  return createHash("sha256").update(JSON.stringify(poses, (_key, v) => typeof v === "number" ? Number(v.toFixed(8)) : v)).digest("hex");
}
