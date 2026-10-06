import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { RB2140_3D_GLASSES } from "../src/constants/virtual-try-on.js";
import { validateTryOnModelMetadata } from "../src/virtual-try-on-3d/model-contract.js";

const modelUrl = new URL(`../public${RB2140_3D_GLASSES.modelUrl}`, import.meta.url);
const bytes = await readFile(modelUrl);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== "2c30f78bef6c2ae29eb42348fdb80e0852236ecaece3b38b5b7caf3b089b3ac6") {
  throw new Error("El archivo no corresponde al RB2140 V2.19 verificado.");
}
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
gltf.scene.updateMatrixWorld(true);

function bounds(name) {
  const mesh = gltf.scene.getObjectByName(name);
  if (!mesh?.isMesh) throw new Error(`No se encontró la pieza ${name}.`);
  return new Box3().setFromObject(mesh);
}

function center(name) {
  return bounds(name).getCenter(new Vector3()).toArray();
}

const front = bounds("FRAME_FRONT");
const fitOrigin = [0, front.getCenter(new Vector3()).y, front.max.z];
const frontDepthMm = (front.max.z - front.min.z) * 1000;

const metadata = validateTryOnModelMetadata({
  schemaVersion: 1,
  analysis: { confidence: 1, status: "valid", warnings: [] },
  identity: {
    modelId: RB2140_3D_GLASSES.assetId,
    name: RB2140_3D_GLASSES.name,
    sku: RB2140_3D_GLASSES.sku,
    sourceFilename: "RB2140-901-50-v2.19.glb",
    sha256,
  },
  dimensionsMm: {
    bridgeWidth: 22,
    frameWidth: front.getSize(new Vector3()).x * 1000,
    lensWidth: 50,
    templeLength: 150,
  },
  fitting: { verticalOffsetMm: 2 },
  anchorsRaw: {
    // Punto de apoyo posterior del puente, trazado en la foto frontal de referencia.
    bridge: [0, 0.0067718963623046875, -0.001896804690361023],
    fitOrigin,
    hingeLeft: center("HINGE_LEFT_KNUCKLE_2"),
    hingeRight: center("HINGE_RIGHT_KNUCKLE_2"),
  },
  nodes: {
    front: ["FRAME_FRONT", "RIVET_FRONT_LEFT", "RIVET_FRONT_RIGHT"],
    bridge: ["FRAME_FRONT"],
    hingeLeft: ["HINGE_LEFT", ...Array.from({ length: 5 }, (_, i) => `HINGE_LEFT_KNUCKLE_${i}`)],
    hingeRight: ["HINGE_RIGHT", ...Array.from({ length: 5 }, (_, i) => `HINGE_RIGHT_KNUCKLE_${i}`)],
    templeLeft: [
      "TEMPLE_LEFT", "MARK_RAYBAN_OUTER_LEFT", "MARK_INSIDE_LEFT",
      "MARK_WAYFARER_PRINT", "MARK_ITALY_PRINT", "MARK_C_PRINT",
    ],
    templeRight: ["TEMPLE_RIGHT", "MARK_RAYBAN_OUTER_RIGHT", "MARK_INSIDE_RIGHT_CODE"],
    lensLeft: ["LENS_LEFT"],
    lensRight: ["LENS_RIGHT"],
    nosepadLeft: [],
    nosepadRight: [],
  },
  normalization: {
    axisConvention: "X_RIGHT_Y_UP_Z_FORWARD",
    millimetersPerUnit: 1000,
    modelYawOffsetDegrees: 0,
    offsetRaw: fitOrigin.map((value) => -value),
  },
  occlusion: {
    frontDepthMm,
    // El frente inclinado y las bisagras se solapan en Z. Conservar 1 mm detrás
    // de TODO el frente y ocluir la porción posterior de las patillas desde allí.
    maskFrontDepthMm: frontDepthMm + 1,
    templeStartDepthMm: frontDepthMm + 2,
  },
});

for (const names of Object.values(metadata.nodes)) names.forEach(bounds);
await writeFile(
  new URL(`../public${RB2140_3D_GLASSES.metadataUrl}`, import.meta.url),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
console.log(`RB2140 V2.19: metadata validada; SHA-256 ${sha256}`);
