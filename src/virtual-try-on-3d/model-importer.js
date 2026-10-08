import { createHash } from "node:crypto";
import { Box3, Matrix4, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { validateTryOnModelMetadata } from "./model-contract.js";

const SAMPLE_LIMIT = 60000;
const FRONT_BAND_FRACTION = 0.18;
const round = (x) => Number(x.toFixed(8));
const vector = (p) => p.toArray().map(round);
const center = (b) => b.getCenter(new Vector3());
const size = (b) => b.getSize(new Vector3());
const bounds = (pts) => new Box3().setFromPoints(pts);

// Node analyses geometry without decoding textures. Strip bindings only from the
// in-memory copy; the source GLB, embedded textures and hash are preserved.
async function parseGeometry(bytes) {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF"
    || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new TypeError("GLB 2 inválido.");
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).trim());
  const externalUri = (item) => item.uri && !item.uri.startsWith("data:");
  if (document.buffers?.some(externalUri) || document.images?.some(externalUri)) throw new TypeError("Se requiere GLB autocontenido.");
  document.materials = (document.materials ?? []).map((m) => ({ name: m.name,
    alphaMode: m.extensions?.KHR_materials_transmission?.transmissionFactor > 0 ? "BLEND" : m.alphaMode, doubleSided: m.doubleSided,
    pbrMetallicRoughness: { baseColorFactor: m.pbrMetallicRoughness?.baseColorFactor } }));
  delete document.textures; delete document.images;
  const json = Buffer.from(JSON.stringify(document)), aligned = Math.ceil(json.length / 4) * 4;
  const remainder = bytes.subarray(20 + jsonLength), clean = Buffer.alloc(20 + aligned + remainder.length, 0x20);
  bytes.copy(clean, 0, 0, 20); clean.writeUInt32LE(clean.length, 8); clean.writeUInt32LE(aligned, 12);
  json.copy(clean, 20); remainder.copy(clean, 20 + aligned);
  if (typeof globalThis.ProgressEvent === "undefined") globalThis.ProgressEvent = class ProgressEvent {};
  return new GLTFLoader().parseAsync(clean.buffer.slice(clean.byteOffset, clean.byteOffset + clean.length), "");
}

function collect(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh || mesh.geometry.morphAttributes.position?.length) throw new TypeError("Se requieren gafas rígidas sin skin/morph.");
    const position = mesh.geometry.getAttribute("position"), points = [];
    const stride = Math.max(1, Math.ceil(position.count / SAMPLE_LIMIT));
    for (let i = 0; i < position.count; i += stride) {
      const p = new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (!p.toArray().every(Number.isFinite)) throw new TypeError("Geometría no finita.");
      points.push(p);
    }
    meshes.push({ name: mesh.name, points, material: mesh.material,
      geometry: mesh.geometry, worldMatrix: mesh.matrixWorld.clone() });
  });
  if (!meshes.length) throw new TypeError("El GLB no contiene mallas.");
  return meshes;
}

// Offline symmetric Jacobi eigensolver. PCA supplies candidate bases independent
// of source rotation. Wide/high front and narrow rear arms identify their roles.
function principalAxes(points) {
  const c = center(bounds(points)), a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  }
  for (let iter = 0; iter < 24; iter++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), cs = Math.cos(angle), sn = Math.sin(angle);
    for (let k = 0; k < 3; k++) {
      const ap = a[k][p], aq = a[k][q]; a[k][p] = cs * ap - sn * aq; a[k][q] = sn * ap + cs * aq;
      const vp = v[k][p], vq = v[k][q]; v[k][p] = cs * vp - sn * vq; v[k][q] = sn * vp + cs * vq;
    }
    for (let k = 0; k < 3; k++) {
      const ap = a[p][k], aq = a[q][k]; a[p][k] = cs * ap - sn * aq; a[q][k] = sn * ap + cs * aq;
    }
  }
  return [0, 1, 2].map((i) => new Vector3(v[0][i], v[1][i], v[2][i]).normalize());
}
function project(p, axes) { return new Vector3(p.dot(axes[0]), p.dot(axes[1]), p.dot(axes[2])); }

function bridgeCrossSection(meshes, axes, x, frontMinZ) {
  const result = [];
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position"), indices = mesh.geometry.index;
    const count = indices?.count ?? position.count;
    const a = new Vector3(), b = new Vector3();
    for (let i = 0; i < count; i += 3) for (const [u, v] of [[0, 1], [1, 2], [2, 0]]) {
      a.fromBufferAttribute(position, indices ? indices.getX(i + u) : i + u).applyMatrix4(mesh.worldMatrix);
      b.fromBufferAttribute(position, indices ? indices.getX(i + v) : i + v).applyMatrix4(mesh.worldMatrix);
      const pa = project(a, axes), pb = project(b, axes);
      if ((pa.x - x) * (pb.x - x) > 0 || Math.abs(pa.x - pb.x) < 1e-10) continue;
      const p = pa.lerp(pb, (x - pa.x) / (pb.x - pa.x));
      if (p.z >= frontMinZ) result.push(p);
    }
  }
  return result;
}

function orientation(points, meshes) {
  const sparse = points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 3000)) === 0);
  const bases = [[new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)], principalAxes(sparse)];
  for (const m of meshes) if (m.points.length >= 9) bases.push(principalAxes(m.points));
  let best = null;
  for (const base of bases) for (const yi of [0, 1, 2]) for (const zi of [0, 1, 2]) {
    if (yi === zi) continue;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const y = base[yi].clone().multiplyScalar(sy), z = base[zi].clone().multiplyScalar(sz), x = y.clone().cross(z).normalize();
      const axes = [x, y, z], pts = sparse.map((p) => project(p, axes)), box = bounds(pts), s = size(box), c = center(box);
      if (s.y > s.x * 0.65 || s.y > s.z * 0.8 || s.x < 1e-8 || s.z < 1e-8 || s.y < 1e-8) continue;
      const band = s.z * FRONT_BAND_FRACTION, front = pts.filter((p) => p.z > box.max.z - band), rear = pts.filter((p) => p.z < box.min.z + band);
      if (!front.length || !rear.length) continue;
      const fs = size(bounds(front)), rs = size(bounds(rear)), central = front.filter((p) => Math.abs(p.x - c.x) < s.x * 0.08);
      const avgY = (list) => list.reduce((sum, p) => sum + p.y, 0) / list.length;
      const up = central.length ? (avgY(central) - avgY(front)) / s.y : 0, hook = (avgY(front) - avgY(rear)) / s.y;
      const score = 3 * fs.x / s.x + 2 * fs.y / s.y - rs.y / s.y + 0.25 * up + 0.2 * hook - 0.2 * s.y / Math.min(s.x, s.z);
      if (!best || score > best.score + 1e-7) best = { score, axes };
    }
  }
  if (!best) throw new TypeError("No se identifica estructura de gafas abiertas.");
  return best;
}

function templeSamples(points, hinge, side) {
  const box = bounds(points), depth = box.max.z - box.min.z, samples = [];
  for (let i = 0; i < 24; i++) {
    const bin = points.filter((p) => p.z <= hinge.z && Math.floor((box.max.z - p.z) / Math.max(depth, 1e-8) * 23) === i);
    if (bin.length) samples.push(vector(bin.reduce((a, b) => side * a.x < side * b.x ? a : b)));
  }
  return samples;
}

function templeCells(points, hinge) {
  const box = bounds(points), depth = box.max.z - box.min.z, cells = [];
  for (let i = 0; i < 48; i++) {
    const bin = points.filter((p) => p.z <= hinge.z && Math.min(47, Math.floor((box.max.z - p.z) / Math.max(depth, 1e-8) * 48)) === i);
    if (bin.length) { const b = bounds(bin); cells.push({ min: vector(b.min), max: vector(b.max) }); }
  }
  return cells;
}

/** Anonymous and fused meshes use the same pipeline. Coordinates never imply
 * physical units: an authoritative width or an explicit units declaration is required. */
export async function analyzeTryOnGlb({ data, dimensionsMm = {}, identity, units = null }) {
  if (!data || !identity) throw new TypeError("data e identity son obligatorios.");
  if (dimensionsMm.frameWidth != null && (!Number.isFinite(dimensionsMm.frameWidth) || dimensionsMm.frameWidth <= 0)) throw new TypeError("frameWidth inválido.");
  if (!dimensionsMm.frameWidth && !["m", "mm"].includes(units)) throw new TypeError("Debe indicar dimensionsMm.frameWidth o units explícito (m/mm).");
  const bytes = Buffer.from(data), gltf = await parseGeometry(bytes);
  try {
    const meshes = collect(gltf.scene), points = meshes.flatMap((m) => m.points), { axes, score } = orientation(points, meshes);
    const projected = points.map((p) => project(p, axes)), all = bounds(projected), s = size(all), mid = center(all);
    const frontPoints = projected.filter((p) => p.z >= all.max.z - s.z * FRONT_BAND_FRACTION), frontBox = bounds(frontPoints), rawWidth = size(frontBox).x;
    const mm = dimensionsMm.frameWidth ? dimensionsMm.frameWidth / rawWidth : units === "m" ? 1000 : 1;
    const bridgePoints = bridgeCrossSection(meshes, axes, mid.x, all.max.z - s.z * FRONT_BAND_FRACTION);
    const bridgeBox = bounds(bridgePoints.length ? bridgePoints : frontPoints);
    // Nose contact = underside of central bridge, posterior bridge surface.
    const bridgeSeat = new Vector3(mid.x, bridgeBox.min.y, bridgeBox.min.z);
    const rotation = new Matrix4().set(axes[0].x, axes[0].y, axes[0].z, -bridgeSeat.x,
      axes[1].x, axes[1].y, axes[1].z, -bridgeSeat.y, axes[2].x, axes[2].y, axes[2].z, -bridgeSeat.z, 0, 0, 0, 1);
    const canonical = new Matrix4().makeScale(mm, mm, mm).multiply(rotation);
    for (const m of meshes) { m.points = m.points.map((p) => p.clone().applyMatrix4(canonical)); m.box = bounds(m.points); m.size = size(m.box); m.center = center(m.box); }
    const canonicalFront = bounds(frontPoints.map((p) => p.clone().sub(bridgeSeat).multiplyScalar(mm))), width = rawWidth * mm, depth = s.z * mm;
    const roles = Object.fromEntries(["front", "bridge", "hingeLeft", "hingeRight", "templeLeft", "templeRight", "lensLeft", "lensRight", "nosepadLeft", "nosepadRight"].map((r) => [r, []]));
    const templeCandidates = { left: [], right: [] };
    for (const m of meshes) {
      const side = m.center.x < 0 ? "Left" : "Right", behind = m.box.min.z < canonicalFront.min.z - depth * 0.15;
      if ((m.size.z > depth * 0.35 && m.size.x < width * 0.4 && Math.abs(m.center.x) > width * 0.25)
        || (behind && m.size.x < width * 0.15 && Math.abs(m.center.x) > width * 0.25)) {
        roles[`temple${side}`].push(m.name); templeCandidates[side.toLowerCase()].push(m);
      } else if (m.size.x > width * 0.15 && m.size.z < depth * 0.3) {
        const material = Array.isArray(m.material) ? m.material[0] : m.material;
        if (/lens/i.test(m.name) || material?.transparent) roles[`lens${side}`].push(m.name); else roles.front.push(m.name);
      }
      if (/bridge/i.test(m.name) || (m.size.x < width * 0.18 && Math.abs(m.center.x) < width * 0.06 && !behind)) roles.bridge.push(m.name);
      if (/hinge/i.test(m.name) || (Math.abs(m.center.x) > width * 0.42 && m.size.x < width * 0.08 && m.size.z < depth * 0.15 && !behind)) roles[`hinge${side}`].push(m.name);
    }
    // Attach small rigid details spatially to the long arm. A logo near a hinge
    // cannot be left floating when its arm opens, even with an arbitrary name.
    for (const [side, sign] of [["left", -1], ["right", 1]]) {
      const suffix = side === "left" ? "Left" : "Right";
      const core = templeCandidates[side].find((m) => m.size.z > depth * 0.35);
      if (!core) continue;
      for (const m of meshes) {
        if (Math.sign(m.center.x) !== sign || m.size.x > width * 0.1 || m.size.z < depth * 0.025
          || m.center.z > core.box.max.z - 1 || Math.abs(m.center.x - core.center.x) > width * 0.15) continue;
        if (!roles[`temple${suffix}`].includes(m.name)) { roles[`temple${suffix}`].push(m.name); templeCandidates[side].push(m); }
        roles[`hinge${suffix}`] = roles[`hinge${suffix}`].filter((name) => name !== m.name);
      }
    }
    if (!roles.bridge.length) roles.bridge = roles.front.filter((name) => {
      const m = meshes.find((item) => item.name === name);
      return m.box.min.x < 0 && m.box.max.x > 0;
    });
    const anchors = {}, temples = {}, add = (role, p, confidence = 0.75) => { anchors[role] = { position: vector(p), confidence, source: "geometry" }; };
    add("bridgeSeat", new Vector3(), bridgePoints.length ? 0.8 : 0.4); add("frontCenter", center(canonicalFront));
    for (const [side, sign] of [["left", -1], ["right", 1]]) {
      const suffix = side === "left" ? "Left" : "Right", pts = templeCandidates[side].flatMap((m) => m.points), parts = meshes.filter((m) => roles[`hinge${suffix}`].includes(m.name));
      const armBox = pts.length ? bounds(pts) : null;
      const hinge = pts.length ? center(bounds(pts.filter((p) => p.z > armBox.max.z - depth * 0.04))) : parts.length ? center(bounds(parts.flatMap((m) => m.points))) : new Vector3(sign * width * 0.47, canonicalFront.max.y, canonicalFront.min.z);
      add(`hinge${suffix}`, hinge, parts.length ? 0.9 : pts.length ? 0.75 : 0.4);
      const lenses = meshes.filter((m) => roles[`lens${suffix}`].includes(m.name));
      add(`lensCenter${suffix}`, lenses.length ? center(bounds(lenses.flatMap((m) => m.points))) : new Vector3(sign * width * 0.25, center(canonicalFront).y, center(canonicalFront).z), lenses.length ? 0.9 : 0.4);
      add(`templeDirection${suffix}`, pts.length ? center(bounds(pts)).sub(hinge).normalize() : new Vector3(0, 0, -1), pts.length ? 0.85 : 0.3);
      temples[side] = { samplesMm: pts.length ? templeSamples(pts, hinge, sign) : [], cellsMm: pts.length ? templeCells(pts, hinge) : [] };
    }
    const bending = temples.left.samplesMm.length > 0 && temples.right.samplesMm.length > 0, lenses = Boolean(roles.lensLeft.length && roles.lensRight.length), warnings = [];
    if (!bending) warnings.push("Patillas no separables: fitting rígido, bending deshabilitado.");
    if (!lenses) warnings.push("Cristales no identificables: materiales originales.");
    if (!bridgePoints.length) warnings.push("Puente aproximado por centro frontal.");
    return validateTryOnModelMetadata({ schemaVersion: 2,
      identity: { ...identity, sha256: createHash("sha256").update(bytes).digest("hex") },
      dimensionsMm: { ...Object.fromEntries(Object.entries(dimensionsMm).filter(([k]) => ["lensWidth", "bridgeWidth", "templeLength"].includes(k))), frameWidth: round(width) },
      normalization: { axisConvention: "X_RIGHT_Y_UP_Z_FORWARD", canonicalFromSource: canonical.toArray().map(round), millimetersPerUnit: round(mm), scaleSource: dimensionsMm.frameWidth ? "frameWidth" : "declaredUnits" },
      anchors, nodes: roles, temples, capabilities: { level: bending && lenses ? "full" : meshes.length > 1 ? "partial" : "basic", templeBending: bending, lensMaterials: lenses },
      analysis: { confidence: Math.min(0.95, Math.max(0.4, score / 6)), status: bridgePoints.length ? "valid" : "review_required", warnings },
      occlusion: { frontDepthMm: round(Math.max(0.1, size(canonicalFront).z)), maskFrontDepthMm: round(Math.max(0.1, -canonicalFront.min.z + 1)) },
    });
  } finally {
    gltf.scene.traverse((m) => { if (!m.isMesh) return; m.geometry.dispose(); for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose(); });
  }
}
