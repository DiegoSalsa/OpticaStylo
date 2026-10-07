import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateTryOnModelMetadata } from "../../src/virtual-try-on-3d/model-contract.js";

const fixture = JSON.parse(readFileSync(new URL(
  "../fixtures/hd0896-v1.json",
  import.meta.url,
), "utf8"));

test("acepta el sidecar versionado del HD0896", () => {
  const metadata = validateTryOnModelMetadata(fixture);
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.analysis.status, "valid");
  assert.equal(metadata.dimensionsMm.frameWidth, 137);
  assert.ok(metadata.nodes.templeLeft.includes("temple_L"));
});

const v2 = JSON.parse(readFileSync(new URL("../../public/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.tryon.json", import.meta.url)));
test("V2 acepta anchors físicos sin piezas obligatorias para Basic", () => {
  const basic = structuredClone(v2); basic.nodes = {}; basic.capabilities = { level: "basic", templeBending: false, lensMaterials: false };
  assert.equal(validateTryOnModelMetadata(basic).capabilities.level, "basic");
});
for (const [name, mutation] of [
  ["NaN", (m) => { m.normalization.canonicalFromSource[0] = NaN; }],
  ["shear", (m) => { m.normalization.canonicalFromSource[1] += 100; }],
  ["reflection", (m) => { for (const i of [0, 1, 2]) m.normalization.canonicalFromSource[i] *= -1; }],
  ["anchor fuera de origen", (m) => { m.anchors.bridgeSeat.position[0] = 1; }],
  ["bending sin muestras", (m) => { m.temples.left.samplesMm = []; }],
  ["ancho inválido", (m) => { m.dimensionsMm.frameWidth = -10; }],
]) test(`V2 rechaza ${name}`, () => { const invalid = structuredClone(v2); mutation(invalid); assert.throws(() => validateTryOnModelMetadata(invalid), /Metadata 3D inválida/); });

test("rechaza una máscara que taparía el frente del marco", () => {
  const invalid = structuredClone(fixture);
  invalid.occlusion.maskFrontDepthMm = invalid.occlusion.frontDepthMm;
  assert.throws(
    () => validateTryOnModelMetadata(invalid),
    /máscara debe quedar entre el frente y el inicio de las patillas/,
  );
});

test("permite guardar análisis dudosos para revisión manual", () => {
  const pending = structuredClone(fixture);
  pending.analysis.status = "review_required";
  pending.analysis.confidence = 0.4;
  pending.nodes.hingeLeft = [];
  assert.equal(validateTryOnModelMetadata(pending).analysis.status, "review_required");
});
