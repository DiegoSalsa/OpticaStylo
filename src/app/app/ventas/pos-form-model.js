export const MONEY_FORMATTER = new Intl.NumberFormat("es-CL", {
  currency: "CLP",
  maximumFractionDigits: 0,
  style: "currency",
});

export const PAYMENT_METHODS = [
  ["CASH", "Efectivo"],
  ["BANK_TRANSFER", "Transferencia"],
  ["TRANSBANK", "Transbank"],
  ["GETNET", "Getnet"],
];

const EMPTY_EYE = { addition: "", axis: "", cylinder: "0", sphere: "0" };

export const EMPTY_EXTERNAL_PRESCRIPTION = {
  fulfillmentNotes: "",
  leftEye: { ...EMPTY_EYE },
  pupillaryDistance: "",
  rightEye: { ...EMPTY_EYE },
};

export const PRESCRIPTION_READER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const ADULT_BIRTH_DATE_CUTOFF = (() => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
})();

export function externalPrescriptionData(value) {
  const eye = (side) => ({
    addition: value[side].addition === "" ? null : Number(value[side].addition),
    axis: value[side].axis === "" ? null : Number(value[side].axis),
    cylinder: Number(value[side].cylinder),
    sphere: Number(value[side].sphere),
  });
  return {
    fulfillmentNotes: value.fulfillmentNotes || null,
    leftEye: eye("leftEye"),
    pupillaryDistance:
      value.pupillaryDistance === "" ? null : Number(value.pupillaryDistance),
    rightEye: eye("rightEye"),
  };
}

function fieldValue(value) {
  return value == null ? "" : String(value);
}

export function externalPrescriptionDraft(value) {
  const eye = (side) => ({
    addition: fieldValue(value?.[side]?.addition),
    axis: fieldValue(value?.[side]?.axis),
    cylinder: fieldValue(value?.[side]?.cylinder),
    sphere: fieldValue(value?.[side]?.sphere),
  });
  return {
    fulfillmentNotes: value?.fulfillmentNotes ?? "",
    leftEye: eye("leftEye"),
    pupillaryDistance: fieldValue(value?.pupillaryDistance),
    rightEye: eye("rightEye"),
  };
}

export function customerDetails(value) {
  return (
    [value.rut, value.email].filter(Boolean).join(" · ") ||
    "Datos de contacto pendientes"
  );
}

export function lensMountLabel(line, lines) {
  if (!line.mount) return null;
  if (line.mount.source === "CUSTOMER_FRAME") return "Montura del cliente";
  return (
    lines.find((item) => item.id === line.mount.frameProductId)?.name ??
    "Montura vendida"
  );
}
