export function itemRequiresPrescription(item) {
  return item?.category === "PRESCRIPTION_LENS" && item.requiresPrescription === true;
}

export function cartRequiresPrescription(items) {
  return Array.isArray(items) && items.some(itemRequiresPrescription);
}

export function cartHasReadyPrescription(cart, items) {
  return !cartRequiresPrescription(items)
    || Boolean(cart?.clinicalPrescriptionId)
    || cart?.externalPrescriptionStatus === "READY"
    || cart?.externalPrescription?.status === "READY";
}
