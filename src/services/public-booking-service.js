import { prisma } from "../db/prisma.js";
import { inventoryId } from "../validations/inventory-validation.js";
import { formatInTimeZone } from "date-fns-tz";
import { PERMISSIONS } from "../auth/permissions.js";
import { createSessionToken, hashSessionToken } from "../auth/session-token.js";
import { getSchedulingTimeZone } from "../config/scheduling.js";
import { getAppointmentReminderHours } from "../config/transactional-email.js";
import { createPublicBooking as createPublicBookingRepository } from "../repositories/appointment-repository.js";
import { findProfessionalById, listProfessionalProfiles } from "../repositories/professional-repository.js";
import { AppError } from "../utils/app-error.js";
import { validatePublicBookingInput } from "../validations/appointment-validation.js";
import { getProfessionalAvailability } from "./schedule-service.js";

const PUBLIC_SCHEDULE_ACTOR = Object.freeze({
  permissions: Object.freeze([PERMISSIONS.SCHEDULES_READ]),
  userId: null,
});

function publicProfessional(professional) {
  return {
    appointmentDurationMinutes: professional.appointmentDurationMinutes,
    firstName: professional.firstName,
    id: professional.id,
    lastName: professional.lastName,
  };
}

function throwProfessionalNotFound() {
  throw new AppError({
    code: "PUBLIC_PROFESSIONAL_NOT_FOUND",
    message: "No se encontró el profesional solicitado.",
    status: 404,
  });
}

function throwUnavailableSlot() {
  throw new AppError({
    code: "PUBLIC_BOOKING_TIME_NOT_AVAILABLE",
    message: "La hora seleccionada ya no se encuentra disponible.",
    status: 409,
  });
}

async function publicLocations(ids) {
  const rows = await prisma.user_branches.findMany({
    where: { user_id: { in: ids }, branches: { is_active: true }, users: { is_active: true,
      professional_profiles_professional_profiles_user_idTousers: { is: { is_bookable: true } },
    } },
    select: { user_id: true, branches: { select: { id: true, name: true } } },
    orderBy: [{ branches: { name: "asc" } }, { branch_id: "asc" }],
  });
  return rows;
}

async function publicLocation(professionalId, branchId) {
  const locations = await publicLocations([professionalId]);
  const id = branchId ? inventoryId(branchId) : locations.length === 1 ? locations[0].branches.id : null;
  if (!locations.some((row) => row.branches.id === id)) throwProfessionalNotFound();
  return id;
}

export async function getPublicProfessionals(dependencies = {}) {
  const listRepository = dependencies.listProfessionalProfiles ?? listProfessionalProfiles;
  const professionals = await listRepository();
  const available = professionals.filter((professional) => professional.isBookable);
  if (dependencies.listProfessionalProfiles) return available.map(publicProfessional);
  const rows = await publicLocations(available.map(({ id }) => id));
  return available.map((professional) => ({
    ...publicProfessional(professional), branches: rows.filter((row) => row.user_id === professional.id).map((row) => row.branches),
  })).filter((professional) => professional.branches.length > 0);
}

export async function getPublicAvailability(professionalId, searchParams, dependencies = {}) {
  const availabilityService = dependencies.getProfessionalAvailability ?? getProfessionalAvailability;
  const branch = Object.hasOwn(dependencies, "appointmentBranch") ? { trustedBranch: dependencies.appointmentBranch }
    : !dependencies.getProfessionalAvailability ? { trustedBranch: await publicLocation(professionalId, searchParams.get("branchId")) } : {};
  const availability = await availabilityService(
    professionalId,
    searchParams,
    PUBLIC_SCHEDULE_ACTOR,
    { currentDate: dependencies.currentDate, timeZone: dependencies.timeZone, ...branch },
  );
  return availability;
}

export async function createPublicBooking(input, dependencies = {}) {
  const currentDate = dependencies.currentDate ?? new Date();
  const data = validatePublicBookingInput(input, currentDate);
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const professional = await findRepository(data.professionalId);
  if (!professional?.isBookable) throwProfessionalNotFound();

  const branchId = dependencies.createPublicBooking ? undefined : await publicLocation(data.professionalId, input.branchId);
  const timeZone = dependencies.timeZone ?? getSchedulingTimeZone();
  const date = formatInTimeZone(data.startAt, timeZone, "yyyy-MM-dd");
  const availability = await (dependencies.getProfessionalAvailability ?? getProfessionalAvailability)(
    data.professionalId,
    new URLSearchParams({ date }),
    PUBLIC_SCHEDULE_ACTOR,
    { currentDate, timeZone, ...(branchId && { trustedBranch: branchId }) },
  );
  const slot = availability.slots.find(
    (candidate) => new Date(candidate.startAt).getTime() === data.startAt.getTime(),
  );
  if (!slot) throwUnavailableSlot();

  const manageToken = (dependencies.createManageToken ?? createSessionToken)();
  const result = await (dependencies.createPublicBooking ?? createPublicBookingRepository)(
    {
      ...(branchId && { branchId }), endAt: new Date(slot.endAt),
      manageTokenHash: (dependencies.hashManageToken ?? hashSessionToken)(manageToken),
      patient: data.patient,
      professionalId: data.professionalId,
      startAt: data.startAt,
    },
    {
      reminderHours: dependencies.reminderHours
        ?? getAppointmentReminderHours(dependencies.environment),
    },
  );

  if (result.conflict === "IDENTITY") {
    throw new AppError({
      code: "PUBLIC_BOOKING_IDENTITY_NOT_VERIFIED",
      message: "Revisa el RUT, la fecha de nacimiento y el correo de la persona atendida. Si ya se atendió en la óptica, usa los datos de su ficha.",
      status: 409,
    });
  }
  if (result.conflict) throwUnavailableSlot();

  return {
    appointment: {
      endAt: result.appointment.endAt,
      id: result.appointment.id,
      professional: result.appointment.professional,
      startAt: result.appointment.startAt,
      status: result.appointment.status,
    },
    manageToken,
  };
}
