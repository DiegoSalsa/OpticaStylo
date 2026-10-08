import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Matrix4, Vector3 } from "three";
import { ellipsoidValue, fitTemple, fitTemples, templeDisplacement } from "../../src/virtual-try-on-3d/temple-fitting.js";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { faceLandmarks } from "../fixtures/vto-fixtures.js";

for (const file of ["Harley-Davidson_HD0896_001_V4_definitivo", "RB2140-901-50-v2.19"]) {
  const metadata = JSON.parse(readFileSync(new URL(`../../public/virtual-try-on/models/${file}.tryon.json`, import.meta.url)));
  const bytes = readFileSync(new URL(`../../public/virtual-try-on/models/${file}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), "");
  gltf.scene.updateMatrixWorld(true);
  for (const headWidth of [115, 135, 150]) test(`${file} todos los vértices, cabeza ${headWidth} mm: clearance >=1 mm`, () => {
    const proxy = { center: [0, -10, -85], radii: [headWidth / 2, 90, 70] };
    const fit = fitTemples(metadata, proxy, { left: [-headWidth / 2, 0, -85], right: [headWidth / 2, 0, -85] });
    for (const side of ["left", "right"]) {
      let minimum = Infinity;
      for (const name of metadata.nodes[`temple${side === "left" ? "Left" : "Right"}`]) {
        const mesh = gltf.scene.getObjectByName(name), position = mesh.geometry.getAttribute("position");
        const matrix = new Matrix4().fromArray(metadata.normalization.canonicalFromSource).multiply(mesh.matrixWorld);
        const vertex = new Vector3();
        for (let i = 0; i < position.count; i++) {
          vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
          vertex.x += fit[side].side * templeDisplacement(fit[side].hinge[2] - vertex.z, fit[side].bendRadians);
          minimum = Math.min(minimum, ellipsoidValue(vertex.toArray(), proxy));
        }
      }
      assert.ok(minimum >= 1 - 1e-6, `${side} mínimo ${minimum}`);
    }
  });
  for (const headWidth of [115, 135, 150]) for (const side of ["left", "right"]) test(`${file} cabeza ${headWidth} mm: patilla ${side} fuera del proxy`, () => {
    const proxy = { center: [0, -10, -85], radii: [headWidth / 2, 90, 70] }, result = fitTemples(metadata, proxy, { left: [-headWidth / 2, 0, -85], right: [headWidth / 2, 0, -85] })[side];
    assert.equal(result.constrained, false);
    for (const point of metadata.temples[side].samplesMm) {
      const deformed = [point[0] + result.side * templeDisplacement(result.hinge[2] - point[2], result.bendRadians), point[1], point[2]];
      assert.ok(ellipsoidValue(deformed, proxy) >= 1 - 1e-6);
    }
  });
  for (const yaw of [-0.785, -0.52, 0.52, 0.785]) test(`${file} yaw ${yaw}: fitting anatómico invariante a perspectiva`, () => {
    const f = faceLandmarks({ yaw }), p = landmarksToGlassesPose(f.landmarks, 1000, 500, metadata, f.transform);
    for (const side of ["left", "right"]) assert.ok(Number.isFinite(p.templeFit[side].bendRadians));
    const frontal = faceLandmarks(), base = landmarksToGlassesPose(frontal.landmarks, 1000, 500, metadata, frontal.transform);
    for (const side of ["left", "right"]) assert.ok(Math.abs(p.templeFit[side].bendRadians - base.templeFit[side].bendRadians) < 0.001);
    assert.notEqual(p.templeFit.left, p.templeFit.right);
  });
  test(`${file}: cabeza asimétrica abre cada lado de manera distinta`, () => {
    const result = fitTemples(metadata, { center: [6, -10, -85], radii: [70, 90, 70] }, { left: [-64, 0, -85], right: [76, 0, -85] });
    assert.ok(Math.abs(result.left.bendRadians - result.right.bendRadians) > 0.01);
  });
}
test("colisión imposible se reporta al alcanzar límite físico", () => {
  const result = fitTemple({ hinge: [40, 0, 0], samples: [[40, 0, -30]], proxy: { center: [0, 0, -40], radii: [120, 100, 80] }, side: 1 });
  assert.equal(result.constrained, true); assert.ok(result.bendRadians <= 0.35);
});
test("apertura no mueve bisagra y la transición tiene pendiente inicial cero", () => {
  assert.equal(templeDisplacement(0, 0.3), 0); assert.equal(templeDisplacement(-5, 0.3), 0);
  assert.ok(templeDisplacement(0.001, 0.3) / 0.001 < 0.001);
});
