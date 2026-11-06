import assert from "node:assert/strict";
import { test } from "node:test";
import { validateExternalPrescriptionData, validatePrescriptionImage, validatePrescriptionImageBytes } from "../../src/validations/store-validation.js";
import { prescription, image } from "./helpers.js";
import { prescriptionFields, opticalData, readCartDraft, writeCartDraft } from "../../src/utils/store-cart-draft.js";

test("Valores válidos, cero y decimales representables con error binario", () => {
  assert.deepEqual(validateExternalPrescriptionData(prescription), prescription);
  assert.equal(validateExternalPrescriptionData({ ...prescription, rightEye: { ...prescription.rightEye, sphere: 9.03 } }).rightEye.sphere, 9.03);
  const form = new FormData();
  for (const [key, value] of Object.entries(prescriptionFields(prescription))) form.set(key, value);
  assert.deepEqual(opticalData(form), prescription);
});
test("Rechaza esfera vacía, decimales excesivos, eje faltante/fuera de rango y distancia negativa", () => {
  for (const change of [{ sphere: null }, { sphere: 1.234 }, { axis: null }, { axis: 181 }, { cylinder: "0" }]) {
    assert.throws(() => validateExternalPrescriptionData({ ...prescription, rightEye: { ...prescription.rightEye, ...change } }));
  }
  assert.throws(() => validateExternalPrescriptionData({ ...prescription, pupillaryDistance: -1 }));
});
test("Validación de imagen: tipo, tamaño, firma y dimensiones reales", () => {
  assert.equal(validatePrescriptionImage(new File([image], "receta.png", { type: "image/png" })).size, image.length);
  assert.deepEqual(validatePrescriptionImageBytes(image, "image/png"), image);
  assert.throws(() => validatePrescriptionImage(new File([image], "receta.svg", { type: "image/svg+xml" })));
  assert.throws(() => validatePrescriptionImage(new File([Buffer.alloc(4 * 1024 * 1024 + 1)], "receta.png", { type: "image/png" })));
  assert.throws(() => validatePrescriptionImageBytes(Buffer.from("archivo falso"), "image/png"));
  const oversized = Buffer.from(image); oversized.writeUInt32BE(9000, 16);
  assert.throws(() => validatePrescriptionImageBytes(oversized, "image/png"));
});
test("El borrador conserva los datos y descarta versiones reemplazadas o carritos cerrados", () => {
  const entries = new Map(); const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
  const cart = { id: "local-test", status: "ACTIVE", externalPrescription: { updatedAt: "v1" } };
  writeCartDraft(storage, cart, { fields: prescriptionFields(prescription) });
  assert.deepEqual(readCartDraft(storage, cart).fields, prescriptionFields(prescription));
  assert.equal(readCartDraft(storage, { ...cart, externalPrescription: { updatedAt: "v2" } }), null);
  writeCartDraft(storage, { ...cart, status: "CHECKED_OUT" }, {}); assert.equal(entries.size, 0);
});
