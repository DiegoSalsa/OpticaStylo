import assert from "node:assert/strict";
import test from "node:test";
import { cartDraftKey, opticalData, prescriptionFields, readCartDraft, writeCartDraft } from "../../src/utils/store-cart-draft.js";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
test("los campos vacíos no se convierten en valores ópticos inventados", () => {
  const form = new FormData();
  form.set("rightSphere", "-1.12"); form.set("rightCylinder", "0");
  form.set("leftSphere", ""); form.set("pupillaryDistance", "");
  const data = opticalData(form);
  assert.equal(data.rightEye.sphere, -1.12);
  assert.equal(data.rightEye.cylinder, 0);
  assert.equal(data.leftEye.sphere, null);
  assert.equal(data.pupillaryDistance, null);
});
test("restaura valores confirmados y mantiene parámetros opcionales vacíos", () => {
  const result = prescriptionFields({ rightEye: { sphere: 0, cylinder: -0.5, axis: 90, addition: null }, pupillaryDistance: 62.25 });
  assert.equal(result.rightSphere, 0);
  assert.equal(result.rightAddition, "");
  assert.equal(result.pupillaryDistance, 62.25);
});
test("los borradores quedan aislados por carrito y se descartan al reemplazar receta o cerrar pedido", () => {
  const store = storage(); const cart = { id: "own", status: "ACTIVE", externalPrescription: { updatedAt: "v1" } };
  writeCartDraft(store, cart, { fields: { rightSphere: "-1.12" }, buyer: { firstNames: "Prueba" } });
  assert.equal(readCartDraft(store, cart).fields.rightSphere, "-1.12");
  assert.equal(readCartDraft(store, { ...cart, id: "other" }), null);
  assert.equal(readCartDraft(store, { ...cart, externalPrescription: { updatedAt: "v2" } }), null);
  writeCartDraft(store, { ...cart, status: "CHECKED_OUT" }, {});
  assert.equal(store.getItem(cartDraftKey(cart.id)), undefined);
});
