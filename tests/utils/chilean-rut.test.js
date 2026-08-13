import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChileanRut } from "../../src/utils/chilean-rut.js";

test("normaliza un RUT chileno válido", () => {
  assert.equal(normalizeChileanRut("12.345.678-5"), "12345678-5");
});

test("acepta el dígito verificador K", () => {
  assert.equal(normalizeChileanRut("1.000.005-K"), "1000005-K");
});

test("rechaza un dígito verificador incorrecto", () => {
  assert.equal(normalizeChileanRut("12.345.678-9"), null);
});
