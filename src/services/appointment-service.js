// Servicio de negocio que coordina reglas, permisos y persistencia de appointment-service.
// Servicio de negocio que coordina reservas.
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

// Determinar si has permiso cumple la condición requerida por la aplicación
function hasPermission(actor, permission) {
  return actor?.permissions?.includes(permission) ?? false;
}

// Construir y lanzar el error de dominio asociado a throw reserva not found
function throwAppointmentNotFound() {
  throw new AppError({
    code: "APPOINTMENT_NOT_FOUND",
    message: "No se encontró la reserva solicitada.",
    status: 404,
  });
}

// Construir y lanzar el error de dominio asociado a throw invalid transition
function throwInvalidTransition(currentStatus, newStatus) {
  throw new AppError({
    code: "INVALID_APPOINTMENT_STATUS_TRANSITION",
    message: `No se puede cambiar una reserva de ${currentStatus} a ${newStatus}.`,
    status: 409,
  });
}

// Construir y lanzar el error de dominio asociado a throw reserva conflict
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

// Verificar require reserva read para impedir que la operación continúe en un estado inválido
function requireAppointmentRead(actor, appointment) {
  if (hasPermission(actor, PERMISSIONS.APPOINTMENTS_READ_ALL)) {
    return;
  }

  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_READ_OWN]);

  if (appointment.professional.id !== actor.userId) {
    throwAppointmentNotFound();
  }
}

// Consultar get own profesional filter y devolver los datos en el formato esperado por la capa llamadora
function getOwnProfessionalFilter(actor) {
  if (hasPermission(actor, PERMISSIONS.APPOINTMENTS_READ_ALL)) {
    return null;
  }

  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_READ_OWN]);
  return actor.userId;
}

// Verificar require reserva para impedir que la operación continúe en un estado inválido
async function requireAppointment(appointmentId, findRepository) {
  const appointment = await findRepository(appointmentId);

  if (!appointment) {
    throwAppointmentNotFound();
  }

  return appointment;
}

// Verificar require bookable slot para impedir que la operación continúe en un estado inválido
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

// Crear o registrar create reserva aplicando las reglas de negocio y persistencia correspondientes
export async function createAppointment(input, actor, dependencies = {}) {
  const patientRepository = dependencies.findPatientById ?? findPatientById;
  const professionalRepository =
    dependencies.findProfessionalById ?? findProfessionalById;
  const availabilityService =
    dependencies.getProfessionalAvailability ?? getProfessionalAvailability;
  const createRepository =
    dependencies.createAppointment ?? createAppointmentRepository;

  // Permitir la operación únicamente a usuarios autorizados para crear reservas
  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_CREATE]);
  // Normalizar y validar los datos recibidos antes de consultar la base de datos
  const data = validateCreateAppointmentInput(input, dependencies.currentDate);
  // Consultar paciente y profesional en paralelo porque ninguna búsqueda depende de la otra
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

  // Verificar que el horario solicitado siga disponible antes de crear la reserva
  const endAt = await requireBookableSlot({
    actor,
    currentDate: dependencies.currentDate,
    getAvailability: availabilityService,
    professionalId: data.professionalId,
    startAt: data.startAt,
    timeZone: dependencies.timeZone ?? getSchedulingTimeZone(),
  });
  // Delegar la persistencia al repositorio, que también registra historial y notificaciones
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

// Consultar get reserva y devolver los datos en el formato esperado por la capa llamadora
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

// Consultar get reserva list y devolver los datos en el formato esperado por la capa llamadora
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

// Actualizar update reserva manteniendo las restricciones y estados permitidos del dominio
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

  // Exigir permiso de edición antes de leer o modificar la reserva
  requirePermissions(actor, [PERMISSIONS.APPOINTMENTS_UPDATE]);
  const normalizedId = validateAppointmentId(appointmentId);
  const current = await requireAppointment(normalizedId, findRepository);
  const changes = validateUpdateAppointmentInput(input, dependencies.currentDate);

  if (current.status !== "CONFIRMED") {
    throwInvalidTransition(current.status, "UPDATED");
  }

  // Si cambia la hora, volver a comprobar disponibilidad excluyendo la propia reserva
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

// Actualizar change reserva estado manteniendo las restricciones y estados permitidos del dominio
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

  // Impedir que una reserva se complete fuera del flujo de atención clínica finalizada
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

  // Aplicar únicamente las transiciones de estado declaradas por el dominio
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

// Consultar get reserva historial y devolver los datos en el formato esperado por la capa llamadora
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
