import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { getSchedulingTimeZone } from "../config/scheduling.js";
import { getAppointmentReminderHours } from "../config/transactional-email.js";
import { formatInTimeZone } from "date-fns-tz";
import {
  changeAppointmentStatus as changeAppointmentStatusRepository,
  createAppointment as createAppointmentRepository,
  findAppointmentById,
  getAppointmentHistory as getAppointmentHistoryRepository,
  listAppointments,
  updateAppointment as updateAppointmentRepository,
} from "../repositories/appointment-repository.js";
import { findPatientById } from "../repositories/patient-repository.js";
import { findProfessionalById } from "../repositories/professional-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateAppointmentId,
  validateAppointmentListQuery,
  validateAppointmentStatusInput,
  validateCreateAppointmentInput,
  validateUpdateAppointmentInput,
} from "../validations/appointment-validation.js";
import { getProfessionalAvailability } from "./schedule-service.js";

const STATUS_TRANSITIONS = Object.freeze({
  CHECKED_IN: Object.freeze([]),
  CONFIRMED: Object.freeze(["CHECKED_IN", "CANCELLED", "NO_SHOW"]),
});

function hasPermission(actor, permission) {
  return actor?.permissions?.includes(permission) ?? false;
}

function throwAppointmentNotFound() {
  throw new AppError({
    code: "APPOINTMENT_NOT_FOUND",
    message: "No se encontró la reserva solicitada.",
    status: 404,
  });
}

function throwInvalidTransition(currentStatus, newStatus) {
  throw new AppError({
    code: "INVALID_APPOINTMENT_STATUS_TRANSITION",
    message: `No se puede cambiar una reserva de ${currentStatus} a ${newStatus}.`,
    status: 409,
  });
}

function throwAppointmentConflict(conflict) {
  const isScheduleBlock = conflict === "SCHEDULE_BLOCK";

  throw new AppError({
    code: isScheduleBlock
      ? "APPOINTMENT_OVERLAPS_SCHEDULE_BLOCK"
      : "APPOINTMENT_TIME_NOT_AVAILABLE",
    message: isScheduleBlock
      ? "La hora solicitada coincide con un bloqueo de agenda."
      : "La hora solicitada ya no se encuentra disponible.",
    status: 409,
  });
}

function requireAppointmentRead(actor, appointment) {
  if (hasPermission(actor, PERMISSIONS.APPOINTMENTS_READ_ALL)) {
    return;
  }

  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_READ_OWN]);

  if (appointment.professional.id !== actor.userId) {
    throwAppointmentNotFound();
  }
}

function getOwnProfessionalFilter(actor) {
  if (hasPermission(actor, PERMISSIONS.APPOINTMENTS_READ_ALL)) {
    return null;
  }

  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_READ_OWN]);
  return actor.userId;
}

async function requireAppointment(appointmentId, findRepository) {
  const appointment = await findRepository(appointmentId);

  if (!appointment) {
    throwAppointmentNotFound();
  }

  return appointment;
}

async function requireBookableSlot({
  actor,
  currentDate,
  excludedAppointmentId,
  getAvailability,
  professionalId,
  startAt,
  timeZone,
}) {
  const date = formatInTimeZone(startAt, timeZone, "yyyy-MM-dd");
  const availability = await getAvailability(
    professionalId,
    new URLSearchParams({ date }),
    actor,
    { currentDate, excludedAppointmentId, timeZone },
  );
  const matchingSlot = availability.slots.find(
    (slot) => new Date(slot.startAt).getTime() === startAt.getTime(),
  );

  if (!matchingSlot) {
    throwAppointmentConflict("APPOINTMENT");
  }

  return new Date(matchingSlot.endAt);
}

export async function createAppointment(input, actor, dependencies = {}) {
  const patientRepository = dependencies.findPatientById ?? findPatientById;
  const professionalRepository =
    dependencies.findProfessionalById ?? findProfessionalById;
  const availabilityService =
    dependencies.getProfessionalAvailability ?? getProfessionalAvailability;
  const createRepository =
    dependencies.createAppointment ?? createAppointmentRepository;

  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_CREATE]);
  const data = validateCreateAppointmentInput(input, dependencies.currentDate);
  const [patient, professional] = await Promise.all([
    patientRepository(data.patientId),
    professionalRepository(data.professionalId),
  ]);

  if (!patient) {
    throw new AppError({
      code: "PATIENT_NOT_FOUND",
      message: "No se encontró el paciente solicitado.",
      status: 404,
    });
  }

  if (!professional) {
    throw new AppError({
      code: "PROFESSIONAL_NOT_FOUND",
      message: "No se encontró el profesional solicitado.",
      status: 404,
    });
  }

  const endAt = await requireBookableSlot({
    actor,
    currentDate: dependencies.currentDate,
    getAvailability: availabilityService,
    professionalId: data.professionalId,
    startAt: data.startAt,
    timeZone: dependencies.timeZone ?? getSchedulingTimeZone(),
  });
  const result = await createRepository(
    { ...data, endAt },
    actor.userId,
    {
      reminderHours: dependencies.reminderHours
        ?? getAppointmentReminderHours(dependencies.environment),
    },
  );

  if (result.conflict) {
    throwAppointmentConflict(result.conflict);
  }

  return result.appointment;
}

export async function getAppointment(
  appointmentId,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findAppointmentById ?? findAppointmentById;
  const normalizedId = validateAppointmentId(appointmentId);
  const appointment = await requireAppointment(normalizedId, findRepository);

  requireAppointmentRead(actor, appointment);
  return appointment;
}

export async function getAppointmentList(
  searchParams,
  actor,
  dependencies = {},
) {
  const listRepository = dependencies.listAppointments ?? listAppointments;
  const query = validateAppointmentListQuery(searchParams);
  const ownProfessionalId = getOwnProfessionalFilter(actor);

  return listRepository({ ...query, ownProfessionalId });
}

export async function updateAppointment(
  appointmentId,
  input,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findAppointmentById ?? findAppointmentById;
  const updateRepository =
    dependencies.updateAppointment ?? updateAppointmentRepository;
  const availabilityService =
    dependencies.getProfessionalAvailability ?? getProfessionalAvailability;

  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_UPDATE]);
  const normalizedId = validateAppointmentId(appointmentId);
  const current = await requireAppointment(normalizedId, findRepository);
  const changes = validateUpdateAppointmentInput(input, dependencies.currentDate);

  if (current.status !== "CONFIRMED") {
    throwInvalidTransition(current.status, "UPDATED");
  }

  const endAt = changes.startAt
    ? await requireBookableSlot({
        actor,
        currentDate: dependencies.currentDate,
        excludedAppointmentId: normalizedId,
        getAvailability: availabilityService,
        professionalId: current.professional.id,
        startAt: changes.startAt,
        timeZone: dependencies.timeZone ?? getSchedulingTimeZone(),
      })
    : undefined;
  const result = await updateRepository(
    normalizedId,
    { ...changes, endAt },
    actor.userId,
  );

  if (!result.appointment && result.currentStatus === null) {
    throwAppointmentNotFound();
  }

  if (result.conflict) {
    throwAppointmentConflict(result.conflict);
  }

  if (!result.appointment) {
    throwInvalidTransition(result.currentStatus, "UPDATED");
  }

  return result.appointment;
}

export async function changeAppointmentStatus(
  appointmentId,
  input,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findAppointmentById ?? findAppointmentById;
  const changeRepository =
    dependencies.changeAppointmentStatus ?? changeAppointmentStatusRepository;
  const normalizedId = validateAppointmentId(appointmentId);
  const statusData = validateAppointmentStatusInput(input);
  const current = await requireAppointment(normalizedId, findRepository);

  if (statusData.status === "COMPLETED") {
    throw new AppError({
      code: "APPOINTMENT_COMPLETION_REQUIRES_FINALIZED_ENCOUNTER",
      message:
        "La reserva se completa automáticamente al finalizar su atención clínica.",
      status: 409,
    });
  }

  if (statusData.status === "CANCELLED") {
    requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_CANCEL]);
  } else if (hasPermission(actor, PERMISSIONS.APPOINTMENTS_UPDATE)) {
    // Administradores y ventas pueden gestionar cualquier reserva.
  } else {
    requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_UPDATE_OWN_STATUS]);

    if (current.professional.id !== actor.userId) {
      throwAppointmentNotFound();
    }
  }

  const allowedNewStatuses = STATUS_TRANSITIONS[current.status] ?? [];

  if (!allowedNewStatuses.includes(statusData.status)) {
    throwInvalidTransition(current.status, statusData.status);
  }

  const allowedCurrentStatuses = Object.entries(STATUS_TRANSITIONS)
    .filter(([, statuses]) => statuses.includes(statusData.status))
    .map(([status]) => status);
  const result = await changeRepository(
    normalizedId,
    allowedCurrentStatuses,
    {
      ...statusData,
      changedAt: dependencies.currentDate ?? new Date(),
    },
    actor.userId,
  );

  if (!result.appointment && result.currentStatus === null) {
    throwAppointmentNotFound();
  }

  if (!result.appointment) {
    throwInvalidTransition(result.currentStatus, statusData.status);
  }

  return result.appointment;
}

export async function getAppointmentHistory(
  appointmentId,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findAppointmentById ?? findAppointmentById;
  const historyRepository =
    dependencies.getAppointmentHistory ?? getAppointmentHistoryRepository;
  const normalizedId = validateAppointmentId(appointmentId);
  const appointment = await requireAppointment(normalizedId, findRepository);

  requireAppointmentRead(actor, appointment);

  return {
    appointmentId: normalizedId,
    events: await historyRepository(normalizedId),
  };
}
