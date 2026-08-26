import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCreateProductInput,
  validateProductListQuery,
  validateUpdateProductInput,
} from "../../src/validations/product-validation.js";

const product = {
  category: "frame", name: " Marco  Acetato ", requiresPrescription: false,
  sku: " mar-001 ", unitPriceCents: 49990,
};

test("normaliza un producto y su precio CLP", () => {
  const result = validateCreateProductInput(product);
  assert.equal(result.sku, "MAR-001");
  assert.equal(result.category, "FRAME");
  assert.equal(result.unitPriceCents, 49990);
});

test("rechaza precios fraccionarios o sin lista definida", () => {
  assert.throws(() => validateCreateProductInput({ ...product, unitPriceCents: 10.5 }), /entero positivo/);
  assert.throws(() => validateCreateProductInput({ ...product, unitPriceCents: 0 }), /entero positivo/);
});

test("reserva la receta obligatoria para los cristales ópticos", () => {
  assert.throws(
    () => validateCreateProductInput({ ...product, requiresPrescription: true }),
    /Solo los cristales ópticos pueden requerir receta/,
  );
  assert.equal(validateCreateProductInput({
    ...product,
    category: "prescription_lens",
    requiresPrescription: true,
  }).requiresPrescription, true);
});

test("permite desactivar un producto sin eliminarlo", () => {
  const result = validateUpdateProductInput({ isActive: false }, { ...validateCreateProductInput(product), isActive: true });
  assert.equal(result.isActive, false);
});

test("rechaza vaciar un campo definido del catálogo", () => {
  assert.throws(
    () => validateUpdateProductInput({ unitPriceCents: null }, { ...validateCreateProductInput(product), isActive: true }),
    /entero positivo/,
  );
});

test("valida filtros del catálogo", () => {
  const result = validateProductListQuery(new URLSearchParams("category=frame&excludeCategory=prescription_lens&isActive=true"));
  assert.equal(result.category, "FRAME");
  assert.equal(result.excludeCategory, "PRESCRIPTION_LENS");
  assert.equal(result.isActive, true);
});
