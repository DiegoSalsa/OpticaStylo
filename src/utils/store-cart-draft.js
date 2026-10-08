const EYES = ["right", "left"];
const PARAMETERS = ["Sphere", "Cylinder", "Axis", "Addition"];

export function prescriptionFields(data) {
  const fields = {};
  for (const eye of EYES) for (const parameter of PARAMETERS) {
    fields[`${eye}${parameter}`] = data?.[`${eye}Eye`]?.[parameter.toLowerCase()] ?? "";
  }
  return { ...fields, pupillaryDistance: data?.pupillaryDistance ?? "", fulfillmentNotes: data?.fulfillmentNotes ?? "" };
}

export function opticalData(form) {
  const value = (name) => {
    const raw = form.get(name);
    return raw == null || raw === "" ? null : Number(raw);
  };
  const eye = (prefix) => ({
    addition: value(`${prefix}Addition`), axis: value(`${prefix}Axis`),
    cylinder: value(`${prefix}Cylinder`), sphere: value(`${prefix}Sphere`),
  });
  return {
    fulfillmentNotes: form.get("fulfillmentNotes") || null,
    leftEye: eye("left"), pupillaryDistance: value("pupillaryDistance"), rightEye: eye("right"),
  };
}

export function cartDraftKey(cartId) { return `opticastylo:cart-draft:${cartId}`; }

export function readCartDraft(storage, cart) {
  try {
    const draft = JSON.parse(storage.getItem(cartDraftKey(cart.id)));
    // No restaurar valores de una receta que ya fue reemplazada en otra pestaña.
    return draft?.version === (cart.externalPrescription?.updatedAt ?? null) ? draft : null;
  } catch { return null; }
}

export function writeCartDraft(storage, cart, draft) {
  try {
    if (cart.status !== "ACTIVE") storage.removeItem(cartDraftKey(cart.id));
    else storage.setItem(cartDraftKey(cart.id), JSON.stringify({ ...draft, version: cart.externalPrescription?.updatedAt ?? null }));
  } catch { /* El carrito confirmado sigue persistido en servidor sin almacenamiento local. */ }
}
