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

export async function getPublicProfessionals(dependencies = {}) {
  const listRepository = dependencies.listProfessionalProfiles ?? listProfessionalProfiles;
  const professionals = await listRepository();
  return professionals.filter((professional) => professional.isBookable).map(publicProfessional);
}

export async function getPublicAvailability(professionalId, searchParams, dependencies = {}) {
  const availabilityService = dependencies.getProfessionalAvailability ?? getProfessionalAvailability;
  const availability = await availabilityService(
    professionalId,
    searchParams,
    PUBLIC_SCHEDULE_ACTOR,
    { currentDate: dependencies.currentDate, timeZone: dependencies.timeZone },
  );
  return availability;
}

export async function createPublicBooking(input, dependencies = {}) {
  const currentDate = dependencies.currentDate ?? new Date();
  const data = validatePublicBookingInput(input, currentDate);
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const professional = await findRepository(data.professionalId);
  if (!professional?.isBookable) throwProfessionalNotFound();

  const timeZone = dependencies.timeZone ?? getSchedulingTimeZone();
  const date = formatInTimeZone(data.startAt, timeZone, "yyyy-MM-dd");
  const availability = await (dependencies.getProfessionalAvailability ?? getProfessionalAvailability)(
    data.professionalId,
    new URLSearchParams({ date }),
    PUBLIC_SCHEDULE_ACTOR,
    { currentDate, timeZone },
  );
  const slot = availability.slots.find(
    (candidate) => new Date(candidate.startAt).getTime() === data.startAt.getTime(),
  );
  if (!slot) throwUnavailableSlot();

  const manageToken = (dependencies.createManageToken ?? createSessionToken)();
  const result = await (dependencies.createPublicBooking ?? createPublicBookingRepository)(
    {
      endAt: new Date(slot.endAt),
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
      message: "No pudimos validar los datos ingresados. Comuníquese con la óptica para reservar.",
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
