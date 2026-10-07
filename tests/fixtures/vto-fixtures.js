import { BoxGeometry, Euler, Matrix4, Quaternion, Vector3 } from "three";

export function faceLandmarks({ yaw = 0, pitch = 0, roll = 0, zoom = 1, x = 0, y = 0 } = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const points = { 33: [-150, 50, -20], 263: [150, 50, -20], 6: [0, 35, 0], 1: [0, 0, 35],
    10: [0, 150, -40], 152: [0, -150, -45], 234: [-250, -5, -50], 454: [250, -5, -50],
    127: [-220, 70, -65], 356: [220, 70, -65] };
  const quaternion = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll));
  const origin = new Vector3(0, 35, 0);
  for (const [index, position] of Object.entries(points)) {
    const p = new Vector3().fromArray(position).sub(origin).applyQuaternion(quaternion).multiplyScalar(zoom).add(origin);
    const perspective = 1000 / (1000 - p.z);
    landmarks[index] = { x: 0.5 + (p.x + x) * perspective / 1000, y: 0.5 - (p.y + y) * perspective / 500, z: -p.z / 1000 };
  }
  return { landmarks, transform: { rows: 4, columns: 4, data: new Matrix4().makeRotationFromQuaternion(quaternion).toArray() } };
}

export function transformGlb(bytes, matrix, rename = false) {
  const n = bytes.readUInt32LE(12), doc = JSON.parse(bytes.toString("utf8", 20, 20 + n).trim());
  if (rename) { doc.nodes.forEach((node, i) => { node.name = `component_${i}`; }); doc.meshes.forEach((m, i) => { m.name = `shape_${i}`; }); }
  const wrapper = doc.nodes.length;
  doc.nodes.push({ name: "source_transform", matrix: matrix.toArray(), children: doc.scenes[doc.scene ?? 0].nodes });
  doc.scenes[doc.scene ?? 0].nodes = [wrapper];
  return packGlb(doc, bytes.subarray(20 + n));
}

function packGlb(doc, binaryChunks) {
  const json = Buffer.from(JSON.stringify(doc)), n = Math.ceil(json.length / 4) * 4;
  const out = Buffer.alloc(20 + n + binaryChunks.length, 0x20);
  out.write("glTF", 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(n, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20); binaryChunks.copy(out, 20 + n);
  return out;
}

// A bridge, two fronts and hooked arms, merged when requested. Tests exercise
// equivalent geometry, not just mocked boxes/metadata from the implementation.
export function syntheticGlb(fused = false) {
  const shapes = [[55, 35, 5, -37, 0, 0], [55, 35, 5, 37, 0, 0], [20, 6, 5, 0, 12, 0],
    [4, 7, 125, -67, 10, -62], [4, 7, 125, 67, 10, -62],
    [4, 20, 18, -67, 0, -130], [4, 20, 18, 67, 0, -130]];
  const lists = shapes.map(([w, h, d, x, y, z]) => {
    const g = new BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
    const array = Array.from(g.getAttribute("position").array); g.dispose(); return array;
  });
  const arrays = fused ? [lists.flat()] : lists;
  let offset = 0;
  const accessors = [], bufferViews = [], buffers = [];
  for (const arr of arrays) {
    const b = Buffer.from(new Float32Array(arr).buffer), points = [];
    for (let i = 0; i < arr.length; i += 3) points.push(new Vector3(arr[i], arr[i + 1], arr[i + 2]));
    const min = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p.toArray()[axis])));
    const max = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p.toArray()[axis])));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length });
    accessors.push({ bufferView: accessors.length, componentType: 5126, count: arr.length / 3, type: "VEC3", min, max });
    buffers.push(b); offset += b.length;
  }
  const binary = Buffer.concat(buffers), chunk = Buffer.alloc(8 + binary.length);
  chunk.writeUInt32LE(binary.length, 0); chunk.writeUInt32LE(0x004e4942, 4); binary.copy(chunk, 8);
  return packGlb({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: arrays.map((_, i) => i) }],
    nodes: arrays.map((_, i) => ({ name: `arbitrary_${i}`, mesh: i })), meshes: arrays.map((_, i) => ({ primitives: [{ attributes: { POSITION: i } }] })),
    buffers: [{ byteLength: binary.length }], bufferViews, accessors }, chunk);
}
