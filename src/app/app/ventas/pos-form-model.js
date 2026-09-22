// Código de la aplicación para pos-form-model.
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

// Centralizar la lógica de adult birth date cutoff para mantener consistente el comportamiento de la aplicación
export const ADULT_BIRTH_DATE_CUTOFF = (() => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
})();

// Centralizar la lógica de externo receta datos para mantener consistente el comportamiento de la aplicación
export function externalPrescriptionData(value) {
  // Centralizar la lógica de eye para mantener consistente el comportamiento de la aplicación
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

// Centralizar la lógica de field value para mantener consistente el comportamiento de la aplicación
function fieldValue(value) {
  return value == null ? "" : String(value);
}

// Centralizar la lógica de externo receta draft para mantener consistente el comportamiento de la aplicación
export function externalPrescriptionDraft(value) {
  // Centralizar la lógica de eye para mantener consistente el comportamiento de la aplicación
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

// Centralizar la lógica de cliente details para mantener consistente el comportamiento de la aplicación
export function customerDetails(value) {
  return (
    [value.rut, value.email].filter(Boolean).join(" · ") ||
    "Datos de contacto pendientes"
  );
}

// Centralizar la lógica de lente mount label para mantener consistente el comportamiento de la aplicación
export function lensMountLabel(line, lines) {
  if (!line.mount) return null;
  if (line.mount.source === "CUSTOMER_FRAME") return "Montura del cliente";
  return (
    lines.find((item) => item.id === line.mount.frameProductId)?.name ??
    "Montura vendida"
  );
}
