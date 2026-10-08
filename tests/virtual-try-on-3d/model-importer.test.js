import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analyzeTryOnGlb } from "../../src/virtual-try-on-3d/model-importer.js";

test("normaliza el HD0896 una sola vez y detecta sus piezas", async () => {
  const sourceUrl = new URL(
    "../../public/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.glb",
    import.meta.url,
  );
  const metadata = await analyzeTryOnGlb({
    data: await readFile(sourceUrl),
    dimensionsMm: {
      bridgeWidth: 15,
      frameWidth: 137,
      lensWidth: 56,
      templeLength: 145,
      verticalOffsetMm: 2,
    },
    identity: {
      modelId: "harley-davidson-hd0896-001-v4",
      name: "Harley-Davidson HD0896",
      sku: "HD0896-001",
      sourceFilename: "Harley-Davidson_HD0896_001_V4_definitivo.glb",
    },
  });

  assert.equal(metadata.analysis.status, "valid");
  assert.deepEqual(metadata.dimensionsMm, {
    bridgeWidth: 15,
    frameWidth: 137,
    lensWidth: 56,
    templeLength: 145,
  });
  assert.ok(metadata.nodes.front.includes("frame_rim_L"));
  assert.ok([...metadata.nodes.hingeLeft, ...metadata.nodes.hingeRight].includes("hinge_pin_L"));
  assert.ok(metadata.nodes.templeRight.includes("temple_L"));
  assert.ok(metadata.anchors.hingeLeft.position[0] < 0);
  assert.ok(metadata.anchors.hingeRight.position[0] > 0);
  assert.equal(metadata.capabilities.level, "full");
  assert.deepEqual(metadata.anchors.bridgeSeat.position, [0, 0, 0]);
  assert.equal(metadata.normalization.modelYawOffsetDegrees, undefined);
});
