import { AppError } from "../utils/app-error.js";
import { validateAppointmentId } from "./appointment-validation.js";
import { validatePatientId } from "./patient-validation.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDICAL_RECORD_FIELDS = Object.freeze([
  "generalMedicalHistory",
  "ocularHistory",
  "familyOcularHistory",
  "allergies",
  "currentMedications",
]);
const ENCOUNTER_FIELDS = Object.freeze([
  "reasonForVisit",
  "anamnesis",
  "examination",
  "diagnosis",
  "indications",
]);

function throwValidationError(message) {
  throw new AppError({
    code: "INVALID_CLINICAL_DATA",
    message,
    status: 400,
  });
}

function validateObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }
}

function normalizeText(value) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function validateOptionalText(value, fieldName, maximumLength) {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throwValidationError(`${fieldName} debe ser texto o null.`);
  }

  const normalized = normalizeText(value);

  if (!normalized || normalized.length > maximumLength) {
    throwValidationError(
      `${fieldName} debe contener entre 1 y ${maximumLength} caracteres.`,
    );
  }

  return normalized;
}

function validateRequiredText(value, fieldName, maximumLength) {
  const normalized = validateOptionalText(value, fieldName, maximumLength);

  if (!normalized) {
    throwValidationError(`${fieldName} es obligatorio.`);
  }

  return normalized;
}

function validateUuid(value, entityName) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throwValidationError(`El identificador de ${entityName} no es válido.`);
  }

  return value.toLowerCase();
}

function validateDecimal(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) >= 10_000 ||
    Math.abs(value * 100 - Math.round(value * 100)) > Number.EPSILON * 100
  ) {
    throwValidationError(`${fieldName} debe ser un número con hasta 2 decimales.`);
  }

  return Object.is(value, -0) ? 0 : value;
}

function validateEye(input, eyeName) {
  validateObject(input);

  const sphere = validateDecimal(input.sphere, `La esfera de ${eyeName}`);
  const cylinder = validateDecimal(input.cylinder, `El cilindro de ${eyeName}`);
  let axis = null;

  if (input.axis !== null && input.axis !== undefined && input.axis !== "") {
    if (!Number.isInteger(input.axis) || input.axis < 0 || input.axis > 180) {
      throwValidationError(`El eje de ${eyeName} debe ser un entero entre 0 y 180.`);
    }

    axis = input.axis;
  }

  if (cylinder !== 0 && axis === null) {
    throwValidationError(`El eje de ${eyeName} es obligatorio cuando el cilindro no es 0.`);
  }

  return {
    addition: validateDecimal(input.addition, `La adición de ${eyeName}`, {
      nullable: true,
    }),
    axis,
    cylinder,
    sphere,
  };
}

export function validateMedicalRecordInput(input) {
  validateObject(input);
  const changes = {};

  for (const field of MEDICAL_RECORD_FIELDS) {
    if (Object.hasOwn(input, field)) {
      changes[field] = validateOptionalText(input[field], field, 5000);
    }
  }

  if (Object.keys(changes).length === 0) {
    throwValidationError("Debe indicar al menos un antecedente para actualizar.");
  }

  return changes;
}

export function validateClinicalPatientId(value) {
  return validatePatientId(value);
}

export function validateEncounterId(value) {
  return validateUuid(value, "la atención clínica");
}

export function validatePrescriptionId(value) {
  return validateUuid(value, "la receta óptica");
}

export function validateCreateEncounterInput(input) {
  validateObject(input);

  return {
    anamnesis: Object.hasOwn(input, "anamnesis")
      ? validateOptionalText(input.anamnesis, "La anamnesis", 10000)
      : null,
    appointmentId: validateAppointmentId(input.appointmentId),
    diagnosis: Object.hasOwn(input, "diagnosis")
      ? validateOptionalText(input.diagnosis, "El diagnóstico", 5000)
      : null,
    examination: Object.hasOwn(input, "examination")
      ? validateOptionalText(input.examination, "El examen", 10000)
      : null,
    indications: Object.hasOwn(input, "indications")
      ? validateOptionalText(input.indications, "Las indicaciones", 5000)
      : null,
    reasonForVisit: validateRequiredText(
      input.reasonForVisit,
      "El motivo de consulta",
      1000,
    ),
  };
}

export function validateUpdateEncounterInput(input) {
  validateObject(input);
  const changes = {};

  for (const field of ENCOUNTER_FIELDS) {
    if (!Object.hasOwn(input, field)) {
      continue;
    }

    const maximumLength =
      field === "anamnesis" || field === "examination"
        ? 10000
        : field === "reasonForVisit"
          ? 1000
          : 5000;

    changes[field] =
      field === "reasonForVisit"
        ? validateRequiredText(input[field], "El motivo de consulta", maximumLength)
        : validateOptionalText(input[field], field, maximumLength);
  }

  if (Object.keys(changes).length === 0) {
    throwValidationError("Debe indicar al menos un dato clínico para actualizar.");
  }

  return changes;
}

export function validateAddendumInput(input) {
  validateObject(input);

  return {
    content: validateRequiredText(input.content, "El contenido de la adenda", 5000),
    reason: validateRequiredText(input.reason, "El motivo de la adenda", 500),
  };
}

export function validateCreatePrescriptionInput(input) {
  validateObject(input);

  return {
    fulfillmentNotes: Object.hasOwn(input, "fulfillmentNotes")
      ? validateOptionalText(input.fulfillmentNotes, "Las notas de fabricación", 1000)
      : null,
    leftEye: validateEye(input.leftEye, "ojo izquierdo"),
    pupillaryDistance: validateDecimal(
      input.pupillaryDistance,
      "La distancia pupilar",
      { nullable: true },
    ),
    replacementReason: Object.hasOwn(input, "replacementReason")
      ? validateOptionalText(input.replacementReason, "El motivo de reemplazo", 500)
      : null,
    rightEye: validateEye(input.rightEye, "ojo derecho"),
  };
}

export function validateUpdatePrescriptionInput(input) {
  validateObject(input);
  const changes = {};

  if (Object.hasOwn(input, "rightEye")) {
    changes.rightEye = validateEye(input.rightEye, "ojo derecho");
  }

  if (Object.hasOwn(input, "leftEye")) {
    changes.leftEye = validateEye(input.leftEye, "ojo izquierdo");
  }

  if (Object.hasOwn(input, "pupillaryDistance")) {
    changes.pupillaryDistance = validateDecimal(
      input.pupillaryDistance,
      "La distancia pupilar",
      { nullable: true },
    );
  }

  if (Object.hasOwn(input, "fulfillmentNotes")) {
    changes.fulfillmentNotes = validateOptionalText(
      input.fulfillmentNotes,
      "Las notas de fabricación",
      1000,
    );
  }

  if (Object.keys(changes).length === 0) {
    throwValidationError("Debe indicar al menos un dato de la receta para actualizar.");
  }

  return changes;
}

export function validatePrescriptionListQuery(searchParams) {
  const patientId = searchParams.get("patientId");

  if (!patientId) {
    throwValidationError("Debe indicar patientId para consultar recetas.");
  }

  return { patientId: validatePatientId(patientId) };
}
