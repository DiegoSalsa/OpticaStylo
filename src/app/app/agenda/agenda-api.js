import { APPOINTMENT_STATUSES } from "../../../validations/appointment-validation.js";

const isText = (value) => typeof value === "string";
const isDateTime = (value) => isText(value) && Number.isFinite(Date.parse(value));
const isTime = (value) => value === null || (isText(value) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
const listOf = (isItem) => (value) => Array.isArray(value) && value.every(isItem);
const isNamedUser = (value) => isText(value?.id) && isText(value.firstName) && isText(value.lastName);
const isPatient = (value) => isText(value?.id) && isText(value.firstNames) && isText(value.lastNames) && isText(value.rut);
const isTimeRange = (value) => isDateTime(value?.startAt) && isDateTime(value.endAt);
const isProfessional = (value) => isNamedUser(value) && isText(value.email)
  && typeof value.isBookable === "boolean" && Number.isInteger(value.appointmentDurationMinutes)
  && Number.isInteger(value.slotIntervalMinutes);
const isAppointment = (value) => isTimeRange(value) && isText(value.id) && isPatient(value.patient)
  && isNamedUser(value.professional) && APPOINTMENT_STATUSES.includes(value.status);
const isBlock = (value) => isTimeRange(value) && isText(value.id)
  && (value.reason === null || isText(value.reason));
const isScheduleDay = (value) => Number.isInteger(value?.dayOfWeek) && value.dayOfWeek >= 0
  && value.dayOfWeek <= 6 && typeof value.isWorking === "boolean"
  && [value.startTime, value.endTime, value.breakStart, value.breakEnd].every(isTime);

export const agendaContracts = {
  appointment: ["la reserva", isAppointment],
  appointments: ["las reservas", listOf(isAppointment)],
  availability: ["la disponibilidad", (value) => listOf(isTimeRange)(value?.slots)],
  block: ["el bloqueo", isBlock],
  blocks: ["los bloqueos", listOf(isBlock)],
  patients: ["los pacientes", (value) => listOf(isPatient)(value?.items)],
  professional: ["el perfil profesional", isProfessional],
  professionals: ["los profesionales", listOf(isProfessional)],
  schedule: ["el horario semanal", listOf(isScheduleDay)],
  users: ["los usuarios clínicos", (value) => listOf((item) => isNamedUser(item)
    && typeof item.isActive === "boolean" && listOf(isText)(item.roles))(value?.items)],
};

export async function readAgendaResponse(response, [label, isValid]) {
  let body;
  try {
    body = await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw error;
    if (!(error instanceof SyntaxError) && response.ok) throw error;
  }

  if (!response.ok) {
    const message = body?.error?.message;
    throw new Error(isText(message) && message ? message : "No fue posible consultar o guardar " + label + " (HTTP " + response.status + ").");
  }
  if (body?.success !== true || !isValid(body.data)) {
    throw new Error("La API devolvió datos inválidos para " + label + ".");
  }

  return body.data;
}
