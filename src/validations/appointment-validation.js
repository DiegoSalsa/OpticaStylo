import { AppError } from "../utils/app-error.js";
import {
  validateCreatePatientInput,
  validatePatientId,
} from "./patient-validation.js";
import { validateProfessionalId } from "./professional-validation.js";

export const APPOINTMENT_STATUSES = Object.freeze([
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_WITH_TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

function throwValidationError(message) {
  throw new AppError({
    code: "INVALID_APPOINTMENT_DATA",
    message,
    status: 400,
  });
}

function validateObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }
}

function validateDateTime(value, fieldName) {
  if (
    typeof value !== "string" ||
    !ISO_WITH_TIME_ZONE_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throwValidationError(
      `${fieldName} debe ser una fecha ISO 8601 con zona horaria.`,
    );
  }

  return new Date(value);
}

function validateOptionalText(value, fieldName, maximumLength) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throwValidationError(`${fieldName} debe ser texto.`);
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized || normalized.length > maximumLength) {
    throwValidationError(
      `${fieldName} debe contener entre 1 y ${maximumLength} caracteres.`,
    );
  }

  return normalized;
}

export function validateAppointmentId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throwValidationError("El identificador de la reserva no es válido.");
  }

  return value.toLowerCase();
}

export function validateCreateAppointmentInput(input, currentDate = new Date()) {
  validateObject(input);

  const startAt = validateDateTime(input.startAt, "La hora de inicio");

  if (startAt <= currentDate) {
    throwValidationError("La reserva debe comenzar en el futuro.");
  }

  return {
    internalNotes: validateOptionalText(
      input.internalNotes,
      "Las notas internas",
      1000,
    ),
    patientId: validatePatientId(input.patientId),
    professionalId: validateProfessionalId(input.professionalId),
    startAt,
  };
}

export function validatePublicBookingInput(input, currentDate = new Date()) {
  validateObject(input);

  if (input.acceptsPrivacy !== true) {
    throwValidationError("Debe aceptar el tratamiento de sus datos para reservar.");
  }

  if (input.website) {
    throwValidationError("No fue posible procesar la reserva.");
  }

  const appointment = validateCreateAppointmentInput(
    {
      patientId: "00000000-0000-4000-8000-000000000001",
      professionalId: input.professionalId,
      startAt: input.startAt,
    },
    currentDate,
  );

  return {
    patient: validateCreatePatientInput(input.patient, currentDate),
    professionalId: appointment.professionalId,
    startAt: appointment.startAt,
  };
}

export function validateUpdateAppointmentInput(input, currentDate = new Date()) {
  validateObject(input);

  const hasStartAt = Object.hasOwn(input, "startAt");
  const hasInternalNotes = Object.hasOwn(input, "internalNotes");

  if (!hasStartAt && !hasInternalNotes) {
    throwValidationError("Debe indicar la hora o las notas que desea actualizar.");
  }

  const startAt = hasStartAt
    ? validateDateTime(input.startAt, "La hora de inicio")
    : undefined;

  if (startAt && startAt <= currentDate) {
    throwValidationError("La nueva hora debe comenzar en el futuro.");
  }

  return {
    internalNotes: hasInternalNotes
      ? validateOptionalText(input.internalNotes, "Las notas internas", 1000)
      : undefined,
    startAt,
  };
}

export function validateAppointmentStatusInput(input) {
  validateObject(input);

  if (!APPOINTMENT_STATUSES.includes(input.status)) {
    throwValidationError("El estado indicado no es válido.");
  }

  const cancellationReason = validateOptionalText(
    input.cancellationReason,
    "El motivo de cancelación",
    500,
  );

  if (input.status === "CANCELLED" && !cancellationReason) {
    throwValidationError("Debe indicar el motivo de cancelación.");
  }

  if (input.status !== "CANCELLED" && cancellationReason) {
    throwValidationError(
      "El motivo de cancelación solo corresponde al estado CANCELLED.",
    );
  }

  return { cancellationReason, status: input.status };
}

export function validateAppointmentListQuery(searchParams) {
  const from = validateDateTime(searchParams.get("from"), "La fecha inicial");
  const to = validateDateTime(searchParams.get("to"), "La fecha final");

  if (from >= to) {
    throwValidationError("La fecha final debe ser posterior a la inicial.");
  }

  const maximumRange = 366 * 24 * 60 * 60 * 1000;

  if (to - from > maximumRange) {
    throwValidationError("El rango consultado no puede superar 366 días.");
  }

  const patientId = searchParams.get("patientId");
  const professionalId = searchParams.get("professionalId");
  const status = searchParams.get("status");

  if (status && !APPOINTMENT_STATUSES.includes(status)) {
    throwValidationError("El estado usado como filtro no es válido.");
  }

  return {
    from,
    patientId: patientId ? validatePatientId(patientId) : null,
    professionalId: professionalId
      ? validateProfessionalId(professionalId)
      : null,
    status: status || null,
    to,
  };
}
