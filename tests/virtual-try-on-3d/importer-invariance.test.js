import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Matrix4 } from "three";
import { analyzeTryOnGlb } from "../../src/virtual-try-on-3d/model-importer.js";
import { syntheticGlb, transformGlb } from "../fixtures/vto-fixtures.js";

const identity = { modelId: "invariance", name: "Fixture", sku: "TEST", sourceFilename: "fixture.glb" };
const source = syntheticGlb();
const analyze = (data, options = {}) => analyzeTryOnGlb({ data, identity, dimensionsMm: { frameWidth: 137 }, ...options });
const baseline = await analyze(source);
const variants = [
  ["+90 X", new Matrix4().makeRotationX(Math.PI / 2)], ["-90 X", new Matrix4().makeRotationX(-Math.PI / 2)],
  ["180 Y / frontal invertido", new Matrix4().makeRotationY(Math.PI)], ["180 Z", new Matrix4().makeRotationZ(Math.PI)],
  ["metros", new Matrix4().makeScale(0.001, 0.001, 0.001)], ["mm", new Matrix4()],
  ["origen desplazado", new Matrix4().makeTranslation(3000, -4000, 5000)],
  ["rotación arbitraria", new Matrix4().makeRotationY(0.64).multiply(new Matrix4().makeRotationX(0.4))],
];
for (const [label, matrix] of variants) test(`importer canónico equivalente: ${label}`, async () => {
  const m = await analyze(transformGlb(source, matrix, true));
  assert.equal(m.analysis.status, "valid"); assert.equal(m.dimensionsMm.frameWidth, 137);
  for (const role of ["bridgeSeat", "frontCenter", "hingeLeft", "hingeRight"]) {
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(m.anchors[role].position[i] - baseline.anchors[role].position[i]) < 0.1,
      `${label}/${role}/${i}: ${m.anchors[role].position} vs ${baseline.anchors[role].position}`);
  }
});
test("nombres arbitrarios no cambian orientación, puente ni patillas", async () => {
  const m = await analyze(transformGlb(source, new Matrix4(), true));
  assert.deepEqual(m.normalization, baseline.normalization); assert.deepEqual(m.anchors, baseline.anchors);
});
test("malla fusionada conserva orientación y escala con capacidades Basic", async () => {
  const fused = await analyze(syntheticGlb(true));
  assert.equal(fused.analysis.status, "valid"); assert.equal(fused.capabilities.level, "basic");
  assert.equal(fused.capabilities.templeBending, false);
  assert.deepEqual(fused.normalization, baseline.normalization);
});
test("no inventa unidades y permite una sola dimensión física", async () => {
  await assert.rejects(analyze(source, { dimensionsMm: {} }), /frameWidth/);
  const units = await analyze(source, { dimensionsMm: {}, units: "mm" });
  assert.equal(units.normalization.scaleSource, "declaredUnits");
  assert.equal(units.dimensionsMm.frameWidth, 138);
  await assert.rejects(analyze(source, { dimensionsMm: { frameWidth: NaN } }), /inválido/);
});
for (const file of ["Harley-Davidson_HD0896_001_V4_definitivo", "RB2140-901-50-v2.19"]) {
  const bytes = await readFile(new URL(`../../public/virtual-try-on/models/${file}.glb`, import.meta.url));
  const saved = JSON.parse(await readFile(new URL(`../../public/virtual-try-on/models/${file}.tryon.json`, import.meta.url)));
  test(`${file}: sidecar es reproducible con pipeline genérico`, async () => {
    const m = await analyzeTryOnGlb({ data: bytes, identity: saved.identity, dimensionsMm: saved.dimensionsMm });
    assert.deepEqual(m, saved); assert.equal(m.capabilities.level, "full");
  });
  test(`${file}: rotación y nombres arbitrarios preservan fitting`, async () => {
    const m = await analyzeTryOnGlb({ data: transformGlb(bytes, new Matrix4().makeRotationX(Math.PI / 2), true), identity,
      dimensionsMm: saved.dimensionsMm });
    assert.equal(m.analysis.status, "valid");
    for (const role of ["frontCenter", "hingeLeft", "hingeRight"]) for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(m.anchors[role].position[i] - saved.anchors[role].position[i]) < 0.1, `${file} ${role}`);
    }
  });
}
