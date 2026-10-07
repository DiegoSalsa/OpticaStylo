import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { geometryDesktopDigest } from "../fixtures/geometry-desktop.js";

const baseline = JSON.parse(readFileSync(new URL("../fixtures/geometry-desktop-baseline.json", import.meta.url)));
for (const model of Object.keys(baseline.digests)) test(`${model}: geometría desktop completa idéntica a ab3e5be`, () => {
  const metadata = JSON.parse(readFileSync(new URL(`../../public/virtual-try-on/models/${model}.tryon.json`, import.meta.url)));
  assert.equal(geometryDesktopDigest(landmarksToGlassesPose, metadata), baseline.digests[model]);
});
