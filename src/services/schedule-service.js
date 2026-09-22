// Servicio de negocio que coordina reglas, permisos y persistencia de schedule-service.
import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { requireScheduleManagement } from "../auth/schedule-access.js";
import { getSchedulingTimeZone } from "../config/scheduling.js";
import { getBusyAppointments } from "../repositories/appointment-repository.js";
import { findProfessionalById } from "../repositories/professional-repository.js";
import {
  createScheduleBlock as createScheduleBlockRepository,
  findScheduleOverride,
  getScheduleBlocks,
  getScheduleOverrides,
  getWeeklySchedule,
  removeScheduleBlock,
  removeScheduleOverride,
  saveWeeklySchedule,
  upsertScheduleOverride,
} from "../repositories/schedule-repository.js";
import { AppError } from "../utils/app-error.js";
import { getZonedDayRange } from "../utils/zoned-date.js";
import {
  validateAvailabilityQuery,
  validateCreateScheduleBlockInput,
  validateDateOnly,
  validateScheduleBlockId,
  validateScheduleOverrideInput,
  validateWeeklyScheduleInput,
} from "../validations/schedule-validation.js";
import { validateProfessionalId } from "../validations/professional-validation.js";
import { buildAvailabilitySlots } from "./availability-engine.js";

// Construir y lanzar el error de dominio asociado a throw profesional not found
function throwProfessionalNotFound() {
  throw new AppError({
    code: "PROFESSIONAL_NOT_FOUND",
    message: "No se encontró el profesional solicitado.",
    status: 404,
  });
}

// Verificar require profesional para impedir que la operación continúe en un estado inválido
async function requireProfessional(professionalId, findRepository) {
  const professional = await findRepository(professionalId);

  if (!professional) {
    throwProfessionalNotFound();
  }

  return professional;
}

// Consultar get profesional agenda y devolver los datos en el formato esperado por la capa llamadora
export async function getProfessionalSchedule(
  professionalId,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const scheduleRepository = dependencies.getWeeklySchedule ?? getWeeklySchedule;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_READ]);
  const normalizedId = validateProfessionalId(professionalId);
  await requireProfessional(normalizedId, findRepository);

  return scheduleRepository(normalizedId);
}

// Centralizar la lógica de replace profesional agenda para mantener consistente el comportamiento de la aplicación
export async function replaceProfessionalSchedule(
  professionalId,
  input,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const saveRepository = dependencies.saveWeeklySchedule ?? saveWeeklySchedule;
  const normalizedId = validateProfessionalId(professionalId);

  requireScheduleManagement(actor, normalizedId);
  await requireProfessional(normalizedId, findRepository);

  const days = validateWeeklyScheduleInput(input);
  return saveRepository(normalizedId, days);
}

// Consultar get profesional overrides y devolver los datos en el formato esperado por la capa llamadora
export async function getProfessionalOverrides(
  professionalId,
  searchParams,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const listRepository = dependencies.getScheduleOverrides ?? getScheduleOverrides;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_READ]);
  const normalizedId = validateProfessionalId(professionalId);
  await requireProfessional(normalizedId, findRepository);

  const from = validateDateOnly(searchParams.get("from"));
  const to = validateDateOnly(searchParams.get("to"));

  if (from > to) {
    throw new AppError({
      code: "INVALID_SCHEDULE_DATA",
      message: "La fecha final debe ser igual o posterior a la inicial.",
      status: 400,
    });
  }

  return listRepository(normalizedId, from, to);
}

// Actualizar set profesional override manteniendo las restricciones y estados permitidos del dominio
export async function setProfessionalOverride(
  professionalId,
  date,
  input,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const upsertRepository =
    dependencies.upsertScheduleOverride ?? upsertScheduleOverride;
  const normalizedId = validateProfessionalId(professionalId);

  requireScheduleManagement(actor, normalizedId);
  await requireProfessional(normalizedId, findRepository);

  const normalizedDate = validateDateOnly(date);
  const override = validateScheduleOverrideInput(input);

  return upsertRepository(normalizedId, normalizedDate, override, actor.userId);
}

// Eliminar o cancelar delete profesional override de forma controlada y consistente
export async function deleteProfessionalOverride(
  professionalId,
  date,
  actor,
  dependencies = {},
) {
  const removeRepository =
    dependencies.removeScheduleOverride ?? removeScheduleOverride;
  const normalizedId = validateProfessionalId(professionalId);

  requireScheduleManagement(actor, normalizedId);
  const normalizedDate = validateDateOnly(date);
  const removed = await removeRepository(normalizedId, normalizedDate);

  if (!removed) {
    throw new AppError({
      code: "SCHEDULE_OVERRIDE_NOT_FOUND",
      message: "No se encontró la excepción horaria solicitada.",
      status: 404,
    });
  }
}

// Crear o registrar create profesional agenda block aplicando las reglas de negocio y persistencia correspondientes
export async function createProfessionalScheduleBlock(
  professionalId,
  input,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const createRepository =
    dependencies.createScheduleBlock ?? createScheduleBlockRepository;
  const normalizedId = validateProfessionalId(professionalId);

  requireScheduleManagement(actor, normalizedId);
  await requireProfessional(normalizedId, findRepository);

  const block = validateCreateScheduleBlockInput(input, dependencies.currentDate);
  const result = await createRepository(normalizedId, block, actor.userId);

  if (result.conflict === "APPOINTMENT") {
    throw new AppError({
      code: "SCHEDULE_BLOCK_OVERLAPS_APPOINTMENT",
      message: "El bloqueo coincide con una reserva vigente.",
      status: 409,
    });
  }

  return result.block;
}

// Consultar get profesional agenda blocks y devolver los datos en el formato esperado por la capa llamadora
export async function getProfessionalScheduleBlocks(
  professionalId,
  searchParams,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const listRepository = dependencies.getScheduleBlocks ?? getScheduleBlocks;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_READ]);
  const normalizedId = validateProfessionalId(professionalId);
  await requireProfessional(normalizedId, findRepository);

  const from = new Date(searchParams.get("from"));
  const to = new Date(searchParams.get("to"));

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new AppError({
      code: "INVALID_SCHEDULE_DATA",
      message: "El rango de bloqueos no es válido.",
      status: 400,
    });
  }

  return listRepository(normalizedId, from, to);
}

// Eliminar o cancelar delete profesional agenda block de forma controlada y consistente
export async function deleteProfessionalScheduleBlock(
  professionalId,
  blockId,
  actor,
  dependencies = {},
) {
  const removeRepository = dependencies.removeScheduleBlock ?? removeScheduleBlock;
  const normalizedId = validateProfessionalId(professionalId);

  requireScheduleManagement(actor, normalizedId);
  const normalizedBlockId = validateScheduleBlockId(blockId);
  const removed = await removeRepository(normalizedId, normalizedBlockId);

  if (!removed) {
    throw new AppError({
      code: "SCHEDULE_BLOCK_NOT_FOUND",
      message: "No se encontró el bloqueo solicitado.",
      status: 404,
    });
  }
}

// Consultar get profesional disponibilidad y devolver los datos en el formato esperado por la capa llamadora
export async function getProfessionalAvailability(
  professionalId,
  searchParams,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const scheduleRepository = dependencies.getWeeklySchedule ?? getWeeklySchedule;
  const overrideRepository =
    dependencies.findScheduleOverride ?? findScheduleOverride;
  const blockRepository = dependencies.getScheduleBlocks ?? getScheduleBlocks;
  const busyAppointmentRepository =
    dependencies.getBusyAppointments ?? getBusyAppointments;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_READ]);
  const query = validateAvailabilityQuery(professionalId, searchParams);
  const professional = await requireProfessional(
    query.professionalId,
    findRepository,
  );
  const timeZone = dependencies.timeZone ?? getSchedulingTimeZone();
  const dayRange = getZonedDayRange(query.date, timeZone);
  const [weeklySchedule, override, blocks, busyAppointments] = await Promise.all([
    scheduleRepository(query.professionalId),
    overrideRepository(query.professionalId, query.date),
    blockRepository(query.professionalId, dayRange.startAt, dayRange.endAt),
    busyAppointmentRepository(
      query.professionalId,
      dayRange.startAt,
      dayRange.endAt,
      dependencies.excludedAppointmentId,
    ),
  ]);

  return {
    date: query.date,
    professionalId: query.professionalId,
    slots: buildAvailabilitySlots({
      appointmentDurationMinutes: professional.appointmentDurationMinutes,
      blocks: [...blocks, ...busyAppointments],
      date: query.date,
      isBookable: professional.isBookable,
      now: dependencies.currentDate,
      override,
      slotIntervalMinutes: professional.slotIntervalMinutes,
      timeZone,
      weeklySchedule,
    }),
    timeZone,
  };
}
