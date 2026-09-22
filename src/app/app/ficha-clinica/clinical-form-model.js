// Código de la aplicación para clinical-form-model.
export const RECORD_FIELDS = [
  ["generalMedicalHistory", "Antecedentes médicos generales"],
  ["ocularHistory", "Antecedentes oculares"],
  ["familyOcularHistory", "Antecedentes oculares familiares"],
  ["allergies", "Alergias"],
  ["currentMedications", "Medicamentos actuales"],
];

export const EMPTY_RECORD = Object.fromEntries(
  RECORD_FIELDS.map(([field]) => [field, ""]),
);

export const EMPTY_ENCOUNTER = {
  anamnesis: "",
  diagnosis: "",
  examination: "",
  indications: "",
  reasonForVisit: "",
};

const EMPTY_EYE = { addition: "", axis: "", cylinder: "0", sphere: "0" };

export const EMPTY_PRESCRIPTION = {
  fulfillmentNotes: "",
  leftEye: { ...EMPTY_EYE },
  pupillaryDistance: "",
  replacementReason: "",
  rightEye: { ...EMPTY_EYE },
};

export const FIELD_LABELS = Object.fromEntries(RECORD_FIELDS);

export const APPOINTMENT_LABELS = {
  CHECKED_IN: "Presente",
  COMPLETED: "Completada",
  CONFIRMED: "Confirmada",
};

// Centralizar la lógica de number para mantener consistente el comportamiento de la aplicación
const number = (value, nullable = false) =>
  value === "" && nullable ? null : Number(value);

// Centralizar la lógica de clone form para mantener consistente el comportamiento de la aplicación
export const cloneForm = (value) => structuredClone(value);
// Centralizar la lógica de forms match para mantener consistente el comportamiento de la aplicación
export const formsMatch = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

// Centralizar la lógica de medical record form para mantener consistente el comportamiento de la aplicación
export function medicalRecordForm(record) {
  return Object.fromEntries(
    RECORD_FIELDS.map(([field]) => [field, record?.[field] ?? ""]),
  );
}

// Centralizar la lógica de receta form para mantener consistente el comportamiento de la aplicación
export function prescriptionForm(currentPrescription) {
  if (!currentPrescription) return cloneForm(EMPTY_PRESCRIPTION);

  return {
    fulfillmentNotes: currentPrescription.fulfillmentNotes ?? "",
    leftEye: Object.fromEntries(
      Object.entries(currentPrescription.leftEye).map(([key, value]) => [
        key,
        value ?? "",
      ]),
    ),
    pupillaryDistance: currentPrescription.pupillaryDistance ?? "",
    replacementReason: "",
    rightEye: Object.fromEntries(
      Object.entries(currentPrescription.rightEye).map(([key, value]) => [
        key,
        value ?? "",
      ]),
    ),
  };
}

// Transformar format optical value al formato utilizado por el resto de la aplicación
export function formatOpticalValue(value, { axis = false } = {}) {
  if (value === null || value === undefined || value === "") return "—";
  if (axis) return `${value}°`;
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}`;
}

// Centralizar la lógica de receta payload para mantener consistente el comportamiento de la aplicación
export function prescriptionPayload(form, includeReason = false) {
  return {
    fulfillmentNotes: form.fulfillmentNotes || null,
    leftEye: {
      addition: number(form.leftEye.addition, true),
      axis: number(form.leftEye.axis, true),
      cylinder: number(form.leftEye.cylinder),
      sphere: number(form.leftEye.sphere),
    },
    pupillaryDistance: number(form.pupillaryDistance, true),
    ...(includeReason
      ? { replacementReason: form.replacementReason || null }
      : {}),
    rightEye: {
      addition: number(form.rightEye.addition, true),
      axis: number(form.rightEye.axis, true),
      cylinder: number(form.rightEye.cylinder),
      sphere: number(form.rightEye.sphere),
    },
  };
}
