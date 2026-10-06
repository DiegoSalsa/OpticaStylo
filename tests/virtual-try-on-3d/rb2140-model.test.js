import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Box3, MeshPhysicalMaterial, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { BUILT_IN_3D_GLASSES, RB2140_3D_GLASSES } from "../../src/constants/virtual-try-on.js";
import { validateTryOnModelMetadata } from "../../src/virtual-try-on-3d/model-contract.js";
import {
  prepareLensMaterial,
  prepareTempleMaterial,
} from "../../src/virtual-try-on-3d/model-materials.js";

const bytes = await readFile(new URL(
  `../../public${RB2140_3D_GLASSES.modelUrl}`, import.meta.url,
));
const metadata = validateTryOnModelMetadata(JSON.parse(await readFile(new URL(
  `../../public${RB2140_3D_GLASSES.metadataUrl}`, import.meta.url,
), "utf8")));
const gltf = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "",
);
gltf.scene.updateMatrixWorld(true);

test("publica exactamente el RB2140 final con sus marcas y sin recursos externos", () => {
  assert.equal(bytes.length, 2787776);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.identity.sha256);
  assert.equal(metadata.identity.sha256,
    "2c30f78bef6c2ae29eb42348fdb80e0852236ecaece3b38b5b7caf3b089b3ac6");
  const jsonChunkLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonChunkLength).toString("utf8"));
  assert.equal(document.meshes.length, 28);
  assert.equal(document.materials.length, 5);
  assert.ok(document.buffers.every((buffer) => !buffer.uri));
  assert.ok(!document.images?.length);
  for (const name of [
    "MARK_RAYBAN_OUTER_LEFT", "MARK_RAYBAN_OUTER_RIGHT", "MARK_RAYBAN_LENS",
    "MARK_RB_LASER_LENS", "MARK_INSIDE_RIGHT_CODE", "MARK_INSIDE_LEFT",
    "MARK_WAYFARER_PRINT", "MARK_ITALY_PRINT", "MARK_C_PRINT",
  ]) assert.ok(gltf.scene.getObjectByName(name)?.isMesh, name);
  assert.equal(BUILT_IN_3D_GLASSES[0], RB2140_3D_GLASSES);
});

test("los roles de ajuste existen y las inscripciones se mueven con su patilla", () => {
  for (const names of Object.values(metadata.nodes)) {
    for (const name of names) assert.ok(gltf.scene.getObjectByName(name)?.isMesh, name);
  }
  for (const name of ["MARK_RAYBAN_OUTER_LEFT", "MARK_INSIDE_LEFT", "MARK_WAYFARER_PRINT",
    "MARK_ITALY_PRINT", "MARK_C_PRINT"]) assert.ok(metadata.nodes.templeLeft.includes(name));
  for (const name of ["MARK_RAYBAN_OUTER_RIGHT", "MARK_INSIDE_RIGHT_CODE"])
    assert.ok(metadata.nodes.templeRight.includes(name));
  assert.ok(metadata.nodes.bridge.includes("FRAME_FRONT"));
});

test("conserva las medidas nativas y deja todo el frente delante de la máscara", () => {
  const { millimetersPerUnit, offsetRaw, modelYawOffsetDegrees } = metadata.normalization;
  assert.equal(millimetersPerUnit, 1000);
  assert.equal(modelYawOffsetDegrees, 0);
  const offset = new Vector3().fromArray(offsetRaw);
  const front = new Box3().setFromObject(gltf.scene.getObjectByName("FRAME_FRONT"));
  assert.ok(Math.abs(front.getSize(new Vector3()).x * 1000 - metadata.dimensionsMm.frameWidth) < 1e-6);
  front.translate(offset);
  assert.ok(front.min.z * 1000 > -metadata.occlusion.maskFrontDepthMm);
  assert.ok(Math.abs(front.max.z) < 1e-9);
  for (const side of ["LEFT", "RIGHT"]) {
    const lens = new Box3().setFromObject(gltf.scene.getObjectByName(`LENS_${side}`));
    assert.ok(Math.abs(lens.getSize(new Vector3()).x * 1000 - 50) < 0.001);
    const temple = new Box3().setFromObject(gltf.scene.getObjectByName(`TEMPLE_${side}`)).translate(offset);
    assert.ok(temple.min.z * 1000 < -metadata.occlusion.templeStartDepthMm);
    assert.ok(temple.max.z * 1000 > -metadata.occlusion.maskFrontDepthMm);
  }
});

test("los cristales del RB2140 componen su tinte sobre video sin perder el material original", () => {
  const original = gltf.scene.getObjectByName("LENS_LEFT").material;
  const adjusted = original.clone();
  prepareLensMaterial(adjusted, RB2140_3D_GLASSES.lensOpacity, RB2140_3D_GLASSES.lensTintStrength);
  assert.deepEqual(adjusted.color.toArray(), original.color.clone().multiplyScalar(0.05).toArray());
  assert.equal(adjusted.opacity, 0.85);
  assert.equal(adjusted.transmission, 0);
  assert.equal(adjusted.transparent, true);
  assert.equal(adjusted.depthWrite, false);
  assert.equal(original.transmission, 1);
  assert.equal(original.opacity, 1);
  assert.ok(original.color.g > 0.4);
});

test("mantiene el acabado óptico anterior de los otros modelos", () => {
  const material = new MeshPhysicalMaterial();
  prepareLensMaterial(material);
  const shader = { fragmentShader: "#include <opaque_fragment>" };
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes("tryOnLensFresnel"));
  assert.ok(shader.fragmentShader.includes("0.0, 0.24"));
});

test("la apertura de patillas admite ambas orientaciones y comparte los uniformes", () => {
  for (const yaw of [0, 180]) {
    const material = new MeshPhysicalMaterial();
    const bendDirection = Math.cos(yaw * Math.PI / 180) > 0 ? -1 : 1;
    const uniforms = prepareTempleMaterial(material, { bendStart: -0.0022, bendDirection });
    const shader = { uniforms: {}, vertexShader: "#include <begin_vertex>" };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uTryOnTempleBendDirection.value, yaw === 0 ? -1 : 1);
    assert.equal(shader.uniforms.uTryOnTempleBend, uniforms.bendRadians);
    uniforms.bendRadians.value = 0.1;
    assert.equal(shader.uniforms.uTryOnTempleBend.value, 0.1);
    assert.ok(shader.vertexShader.includes("uTryOnTempleBendDirection * (position.z - uTryOnTempleBendStart)"));
  }
});
