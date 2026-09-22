// Centralizar la lógica de item requires receta para mantener consistente el comportamiento de la aplicación
export function itemRequiresPrescription(item) {
  return item?.category === "PRESCRIPTION_LENS" && item.requiresPrescription === true;
}

// Centralizar la lógica de carrito requires receta para mantener consistente el comportamiento de la aplicación
export function cartRequiresPrescription(items) {
  return Array.isArray(items) && items.some(itemRequiresPrescription);
}

// Centralizar la lógica de carrito has ready receta para mantener consistente el comportamiento de la aplicación
export function cartHasReadyPrescription(cart, items) {
  return !cartRequiresPrescription(items)
    || Boolean(cart?.clinicalPrescriptionId)
    || cart?.externalPrescriptionStatus === "READY"
    || cart?.externalPrescription?.status === "READY";
}
// Utilidades compartidas para prescription-requirement.
// Centralizar la lógica de item requires receta para mantener consistente el comportamiento de la aplicación
