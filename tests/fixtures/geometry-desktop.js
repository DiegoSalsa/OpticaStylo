import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";

const face = JSON.parse(readFileSync(new URL("./canonical-face.json", import.meta.url)));
export function canonicalCameraFace(width, height, { yaw = 0, pitch = 0, roll = 0, focalRatio = 1 } = {}) {
  const points = face.vertices.map((p) => new Vector3().fromArray(p)), nose = points[6].clone();
  const scale = width * 0.25 / points[234].distanceTo(points[454]);
  const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll)), focal = width * focalRatio;
  const landmarks = points.map((point) => {
    const v = point.sub(nose).applyQuaternion(q).multiplyScalar(scale), perspective = focal / (focal - v.z);
    return { x: 0.5 + v.x * perspective / width, y: 0.5 - v.y * perspective / height, z: -v.z / width };
  });
  return { landmarks, transform: { data: new Matrix4().makeRotationFromQuaternion(q).toArray() } };
}

export function geometryDesktopDigest(convert, metadata) {
  const outputs = [];
  for (const yaw of [-0.785, -0.52, 0, 0.52, 0.785]) for (const pitch of [-0.3, 0, 0.3]) for (const mirrored of [false, true]) {
    const f = canonicalCameraFace(1280, 720, { yaw, pitch, roll: 0.08 });
    const pose = convert(f.landmarks, 1280, 720, metadata, f.transform, { mirrored });
    outputs.push(pose);
  }
  const json = JSON.stringify(outputs, (_key, value) => typeof value === "number" ? Number(value.toFixed(8)) : value);
  return createHash("sha256").update(json).digest("hex");
}
