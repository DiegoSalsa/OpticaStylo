import { formatInTimeZone } from "date-fns-tz";
import { customerAppointmentChangeDeadline, getCustomerAppointmentNoticeHours } from "../config/customer-appointments.js";
import { getAppointmentReminderHours } from "../config/transactional-email.js";
import { findCustomerAppointment, updateCustomerAppointment } from "../repositories/appointment-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateAppointmentId, validateUpdateAppointmentInput } from "../validations/appointment-validation.js";
import { getPublicAvailability } from "./public-booking-service.js";

function error(code, message, status = 409) {
  return new AppError({ code, message, status });
}

export async function manageCustomerAppointment(account, id, input, dependencies = {}) {
  if (!account?.id) throw error("CUSTOMER_AUTHENTICATION_REQUIRED", "Inicia sesión para gestionar tu hora.", 401);
  const appointmentId = validateAppointmentId(id);
  if (!["CANCEL", "RESCHEDULE"].includes(input?.action)) throw error("INVALID_APPOINTMENT_ACTION", "Elige cancelar o reagendar la hora.", 400);
  const current = await (dependencies.findAppointment ?? findCustomerAppointment)(account.id, appointmentId);
  if (!current) throw error("CUSTOMER_APPOINTMENT_NOT_FOUND", "No encontramos esta hora en tu cuenta.", 404);

  const now = dependencies.now?.() ?? new Date();
  const noticeHours = getCustomerAppointmentNoticeHours(dependencies.environment);
  const originalStart = Date.parse(input.expectedStartAt);
  if (!Number.isFinite(originalStart) || current.start_at.getTime() !== originalStart || current.status !== "CONFIRMED") {
    throw error("CUSTOMER_APPOINTMENT_CHANGED", "La hora cambió. Actualiza Mis horas antes de intentarlo nuevamente.");
  }
  if (customerAppointmentChangeDeadline(current.start_at, noticeHours) <= now) {
    throw error("CUSTOMER_APPOINTMENT_CHANGE_CLOSED", "Ya terminó el plazo para cambiar esta hora en línea. Contacta a la óptica.");
  }

  let slot = null;
  if (input.action === "RESCHEDULE") {
    const { startAt } = validateUpdateAppointmentInput({ startAt: input.startAt }, now);
    const date = formatInTimeZone(startAt, "America/Santiago", "yyyy-MM-dd");
    const availability = await (dependencies.getAvailability ?? getPublicAvailability)(
      current.professional_id, new URLSearchParams({ date }), { currentDate: now },
    );
    const selected = availability.slots.find((item) => Date.parse(item.startAt) === startAt.getTime());
    if (!selected) throw error("CUSTOMER_APPOINTMENT_SLOT_TAKEN", "Esa hora ya no está disponible. Elige otra.");
    slot = { startAt, endAt: new Date(selected.endAt) };
  }

  const result = await (dependencies.updateAppointment ?? updateCustomerAppointment)(account.id, appointmentId, {
    expectedStart: current.start_at,
    noticeHours,
    now: dependencies.now?.() ?? new Date(),
    reminderHours: getAppointmentReminderHours(dependencies.environment),
    slot,
  });
  if (result.reason === "SLOT_TAKEN") throw error("CUSTOMER_APPOINTMENT_SLOT_TAKEN", "Esa hora ya no está disponible. Elige otra.");
  if (result.reason === "CLOSED") throw error("CUSTOMER_APPOINTMENT_CHANGE_CLOSED", "Ya terminó el plazo para cambiar esta hora en línea. Contacta a la óptica.");
  if (result.reason) throw error("CUSTOMER_APPOINTMENT_CHANGED", "La hora cambió. Actualiza Mis horas antes de intentarlo nuevamente.");
  return { updated: true };
}
