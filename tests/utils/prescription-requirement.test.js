import assert from "node:assert/strict";
import test from "node:test";

import {
  cartHasReadyPrescription,
  cartRequiresPrescription,
  itemRequiresPrescription,
} from "../../src/utils/prescription-requirement.js";

const frame = { category: "FRAME", requiresPrescription: true };
const optionalLens = { category: "PRESCRIPTION_LENS", requiresPrescription: false };
const requiredLens = { category: "PRESCRIPTION_LENS", requiresPrescription: true };

test("solo los cristales configurados como obligatorios exigen receta", () => {
  assert.equal(itemRequiresPrescription(frame), false);
  assert.equal(itemRequiresPrescription(optionalLens), false);
  assert.equal(itemRequiresPrescription(requiredLens), true);
  assert.equal(cartRequiresPrescription([frame, optionalLens]), false);
  assert.equal(cartRequiresPrescription([frame, requiredLens]), true);
});

test("acepta una receta externa confirmada o una receta clínica para el carrito", () => {
  assert.equal(cartHasReadyPrescription({}, [requiredLens]), false);
  assert.equal(cartHasReadyPrescription({ externalPrescriptionStatus: "DRAFT" }, [requiredLens]), false);
  assert.equal(cartHasReadyPrescription({ externalPrescriptionStatus: "READY" }, [requiredLens]), true);
  assert.equal(cartHasReadyPrescription({ clinicalPrescriptionId: "receta-clínica" }, [requiredLens]), true);
});
