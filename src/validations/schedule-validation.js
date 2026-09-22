import { AppError } from "../utils/app-error.js";
// Validaciones y normalización de entradas para schedule-validation.
import { validateProfessionalId } from "./professional-validation.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Construir y lanzar el error de dominio asociado a throw validation error
function throwValidationError(message) {
  throw new AppError({
    code: "INVALID_SCHEDULE_DATA",
    message,
    status: 400,
  });
}

// Centralizar la lógica de time to minutes para mantener consistente el comportamiento de la aplicación
function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

// Validar y normalizar validate time antes de continuar con la operación
function validateTime(value, fieldName) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throwValidationError(`${fieldName} debe usar el formato HH:mm.`);
  }

  return value;
}

// Validar y normalizar validate working range antes de continuar con la operación
function validateWorkingRange(value, { allowClosed = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwValidationError("La configuración horaria no es válida.");
  }

  if (typeof value.isWorking !== "boolean") {
    throwValidationError("Debe indicar si el profesional trabaja.");
  }

  if (!value.isWorking && allowClosed) {
    return {
      breakEnd: null,
      breakStart: null,
      endTime: null,
      isWorking: false,
      startTime: null,
    };
  }

  const startTime = validateTime(value.startTime, "La hora de inicio");
  const endTime = validateTime(value.endTime, "La hora de término");

  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    throwValidationError("La hora de término debe ser posterior al inicio.");
  }

  const hasBreakStart = value.breakStart != null && value.breakStart !== "";
  const hasBreakEnd = value.breakEnd != null && value.breakEnd !== "";

  if (hasBreakStart !== hasBreakEnd) {
    throwValidationError("La pausa debe incluir hora de inicio y término.");
  }

  let breakStart = null;
  let breakEnd = null;

  if (hasBreakStart) {
    breakStart = validateTime(value.breakStart, "El inicio de la pausa");
    breakEnd = validateTime(value.breakEnd, "El término de la pausa");

    if (
      timeToMinutes(breakStart) < timeToMinutes(startTime) ||
      timeToMinutes(breakEnd) > timeToMinutes(endTime) ||
      timeToMinutes(breakStart) >= timeToMinutes(breakEnd)
    ) {
      throwValidationError("La pausa debe quedar dentro del horario de trabajo.");
    }
  }

  return {
    breakEnd,
    breakStart,
    endTime,
    isWorking: value.isWorking,
    startTime,
  };
}

// Validar y normalizar validate weekly agenda entrada antes de continuar con la operación
export function validateWeeklyScheduleInput(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.days)) {
    throwValidationError("Debe enviar los siete días de la agenda semanal.");
  }

  if (input.days.length !== 7) {
    throwValidationError("La agenda semanal debe contener exactamente siete días.");
  }

  const days = input.days.map((day) => {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throwValidationError("El día de la semana debe estar entre 0 y 6.");
    }

    return {
      dayOfWeek: day.dayOfWeek,
      ...validateWorkingRange(day),
    };
  });

  if (new Set(days.map((day) => day.dayOfWeek)).size !== 7) {
    throwValidationError("La agenda semanal no puede repetir días.");
  }

  return days.sort((left, right) => left.dayOfWeek - right.dayOfWeek);
}

// Validar y normalizar validate date only antes de continuar con la operación
export function validateDateOnly(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throwValidationError("La fecha debe usar el formato AAAA-MM-DD.");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throwValidationError("La fecha indicada no es válida.");
  }

  return value;
}

// Validar y normalizar validate agenda override entrada antes de continuar con la operación
export function validateScheduleOverrideInput(input) {
  return validateWorkingRange(input, { allowClosed: true });
}

// Validar y normalizar validate instant antes de continuar con la operación
function validateInstant(value, fieldName) {
  if (typeof value !== "string") {
    throwValidationError(`${fieldName} debe ser una fecha ISO 8601.`);
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throwValidationError(`${fieldName} debe ser una fecha ISO 8601.`);
  }

  return parsed;
}

// Validar y normalizar validate create agenda block entrada antes de continuar con la operación
export function validateCreateScheduleBlockInput(input, currentDate = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwValidationError("El cuerpo de la solicitud no es válido.");
  }

  const startAt = validateInstant(input.startAt, "El inicio del bloqueo");
  const endAt = validateInstant(input.endAt, "El término del bloqueo");

  if (endAt <= startAt) {
    throwValidationError("El término del bloqueo debe ser posterior al inicio.");
  }

  if (endAt <= currentDate) {
    throwValidationError("El bloqueo debe terminar en el futuro.");
  }

  let reason = null;

  if (input.reason != null) {
    if (typeof input.reason !== "string") {
      throwValidationError("El motivo del bloqueo no es válido.");
    }

    reason = input.reason.trim().replace(/\s+/g, " ");

    if (!reason || reason.length > 500) {
      throwValidationError("El motivo debe contener entre 1 y 500 caracteres.");
    }
  }

  return { endAt, reason, startAt };
}

// Validar y normalizar validate agenda block id antes de continuar con la operación
export function validateScheduleBlockId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throwValidationError("El identificador del bloqueo no es válido.");
  }

  return value.toLowerCase();
}

// Validar y normalizar validate disponibilidad consulta antes de continuar con la operación
export function validateAvailabilityQuery(professionalId, searchParams) {
  return {
    date: validateDateOnly(searchParams.get("date")),
    professionalId: validateProfessionalId(professionalId),
  };
}
