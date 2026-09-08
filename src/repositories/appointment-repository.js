import { prisma } from "../db/prisma.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

const professionalUser = "users_professional_profiles_user_idTousers";
const appointmentInclude = {
  patients: true,
  professional_profiles: { include: { [professionalUser]: true } },
};

function mapAppointment(row) {
  if (!row) return null;
  const professional = row.professional_profiles[professionalUser];
  return {
    cancellationReason: row.cancellation_reason, cancelledAt: row.cancelled_at,
    createdAt: row.created_at, endAt: row.end_at, id: row.id,
    internalNotes: row.internal_notes,
    patient: {
      firstNames: row.patients.first_names, id: row.patient_id,
      lastNames: row.patients.last_names, rut: row.patients.rut,
    },
    professional: {
      firstName: professional.first_name, id: row.professional_id, lastName: professional.last_name,
    },
    source: row.source, startAt: row.start_at, status: row.status, updatedAt: row.updated_at,
  };
}

function mapEvent(row) {
  return {
    createdAt: row.created_at, details: row.details, eventType: row.event_type,
    id: Number(row.id), newEndAt: row.new_end_at, newStartAt: row.new_start_at,
    newStatus: row.new_status,
    performedBy: row.users ? {
      firstName: row.users.first_name, id: row.performed_by, lastName: row.users.last_name,
    } : null,
    previousEndAt: row.previous_end_at, previousStartAt: row.previous_start_at,
    previousStatus: row.previous_status,
  };
}

async function findAppointmentByIdWithClient(client, appointmentId) {
  return mapAppointment(await client.appointments.findUnique({
    include: appointmentInclude, where: { id: appointmentId },
  }));
}

async function enqueueAppointmentEmails(client, { appointmentId, endAt, recipientEmail, reminderHours, startAt }) {
  const payload = { appointmentId, endAt, startAt };
  const confirmedKey = transactionalEmailDeduplicationKey("APPOINTMENT_CONFIRMED", appointmentId);
  await client.transactional_email_outbox.upsert({
    create: {
      appointment_id: appointmentId, deduplication_key: confirmedKey, payload,
      recipient_email: recipientEmail, template_code: "APPOINTMENT_CONFIRMED",
    },
    update: {}, where: { deduplication_key: confirmedKey },
  });
  const reminderAt = new Date(startAt.getTime() - reminderHours * 3_600_000);
  const scheduledAt = new Date(Math.max(reminderAt.getTime(), Date.now()));
  const reminderKey = transactionalEmailDeduplicationKey("APPOINTMENT_REMINDER", appointmentId);
  await client.transactional_email_outbox.upsert({
    create: {
      appointment_id: appointmentId, deduplication_key: reminderKey,
      next_attempt_at: scheduledAt, payload, recipient_email: recipientEmail,
      scheduled_at: scheduledAt, template_code: "APPOINTMENT_REMINDER",
    },
    update: {}, where: { deduplication_key: reminderKey },
  });
}

async function findCollision(client, professionalId, startAt, endAt, excludedAppointmentId = null) {
  const [appointment, block] = await Promise.all([
    client.appointments.findFirst({
      select: { id: true },
      where: {
        end_at: { gt: startAt }, id: excludedAppointmentId ? { not: excludedAppointmentId } : undefined,
        professional_id: professionalId, start_at: { lt: endAt }, status: { not: "CANCELLED" },
      },
    }),
    client.professional_schedule_blocks.findFirst({
      select: { id: true },
      where: { end_at: { gt: startAt }, professional_id: professionalId, start_at: { lt: endAt } },
    }),
  ]);
  return appointment ? "APPOINTMENT" : block ? "SCHEDULE_BLOCK" : null;
}

export async function findAppointmentById(appointmentId) {
  return findAppointmentByIdWithClient(prisma, appointmentId);
}

export async function listAppointments({ from, ownProfessionalId, patientId, professionalId, status, to }) {
  return (await prisma.appointments.findMany({
    include: appointmentInclude,
    orderBy: [{ start_at: "asc" }, { id: "asc" }],
    where: {
      end_at: { gt: from }, start_at: { lt: to },
      ...(patientId ? { patient_id: patientId } : {}),
      ...(professionalId ? { professional_id: professionalId } : {}),
      ...(ownProfessionalId ? { professional_id: ownProfessionalId } : {}),
      ...(status ? { status } : {}),
    },
  })).map(mapAppointment);
}

export async function getBusyAppointments(professionalId, from, to, excludedAppointmentId = null) {
  const rows = await prisma.appointments.findMany({
    orderBy: [{ start_at: "asc" }, { id: "asc" }],
    select: { end_at: true, start_at: true },
    where: {
      end_at: { gt: from }, professional_id: professionalId, start_at: { lt: to },
      status: { not: "CANCELLED" },
      ...(excludedAppointmentId ? { id: { not: excludedAppointmentId } } : {}),
    },
  });
  return rows.map((row) => ({ endAt: row.end_at, startAt: row.start_at }));
}

export async function createAppointment(appointmentData, actorUserId, options = {}) {
  return prisma.$transaction(async (client) => {
    const conflict = await findCollision(client, appointmentData.professionalId, appointmentData.startAt, appointmentData.endAt);
    if (conflict) return { appointment: null, conflict };
    const created = await client.appointments.create({ data: {
      created_by: actorUserId, end_at: appointmentData.endAt,
      internal_notes: appointmentData.internalNotes, patient_id: appointmentData.patientId,
      professional_id: appointmentData.professionalId, start_at: appointmentData.startAt,
      updated_by: actorUserId,
    } });
    await client.appointment_events.create({ data: {
      appointment_id: created.id, event_type: "CREATED", new_end_at: appointmentData.endAt,
      new_start_at: appointmentData.startAt, new_status: "CONFIRMED", performed_by: actorUserId,
    } });
    const patient = await client.patients.findUnique({ select: { email: true }, where: { id: appointmentData.patientId } });
    await enqueueAppointmentEmails(client, {
      appointmentId: created.id, endAt: appointmentData.endAt,
      recipientEmail: patient.email, reminderHours: options.reminderHours ?? 24,
      startAt: appointmentData.startAt,
    });
    return { appointment: await findAppointmentByIdWithClient(client, created.id), conflict: null };
  }, { isolationLevel: "Serializable" });
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

export async function createPublicBooking(bookingData, options = {}) {
  return prisma.$transaction(async (client) => {
    let patient = await client.patients.findUnique({ where: { rut: bookingData.patient.rut } });
    if (patient && (dateOnly(patient.birth_date) !== bookingData.patient.birthDate || patient.email !== bookingData.patient.email)) {
      return { appointment: null, conflict: "IDENTITY" };
    }
    if (!patient) {
      patient = await client.patients.create({ data: {
        address: bookingData.patient.address,
        birth_date: new Date(`${bookingData.patient.birthDate}T00:00:00.000Z`),
        created_by: null, email: bookingData.patient.email,
        first_names: bookingData.patient.firstNames, last_names: bookingData.patient.lastNames,
        phone: bookingData.patient.phone, rut: bookingData.patient.rut, updated_by: null,
        ...(bookingData.patient.guardian ? { patient_guardians: { create: {
          email: bookingData.patient.guardian.email,
          first_names: bookingData.patient.guardian.firstNames,
          last_names: bookingData.patient.guardian.lastNames,
          phone: bookingData.patient.guardian.phone,
          relationship: bookingData.patient.guardian.relationship,
          rut: bookingData.patient.guardian.rut,
        } } } : {}),
      } });
    }
    const conflict = await findCollision(client, bookingData.professionalId, bookingData.startAt, bookingData.endAt);
    if (conflict) return { appointment: null, conflict };
    const created = await client.appointments.create({ data: {
      created_by: null, end_at: bookingData.endAt, patient_id: patient.id,
      professional_id: bookingData.professionalId,
      public_manage_token_hash: bookingData.manageTokenHash, source: "PUBLIC",
      start_at: bookingData.startAt, updated_by: null,
    } });
    await client.appointment_events.create({ data: {
      appointment_id: created.id, event_type: "CREATED", new_end_at: bookingData.endAt,
      new_start_at: bookingData.startAt, new_status: "CONFIRMED", performed_by: null,
    } });
    await enqueueAppointmentEmails(client, {
      appointmentId: created.id, endAt: bookingData.endAt,
      recipientEmail: bookingData.patient.email, reminderHours: options.reminderHours ?? 24,
      startAt: bookingData.startAt,
    });
    return { appointment: await findAppointmentByIdWithClient(client, created.id), conflict: null };
  }, { isolationLevel: "Serializable" });
}

export async function updateAppointment(appointmentId, changes, actorUserId) {
  return prisma.$transaction(async (client) => {
    const current = await client.appointments.findUnique({ where: { id: appointmentId } });
    if (!current) return { appointment: null, conflict: null, currentStatus: null };
    if (current.status !== "CONFIRMED") return { appointment: null, conflict: null, currentStatus: current.status };
    if (changes.startAt) {
      const conflict = await findCollision(client, current.professional_id, changes.startAt, changes.endAt, appointmentId);
      if (conflict) return { appointment: null, conflict, currentStatus: current.status };
    }
    const newStartAt = changes.startAt ?? current.start_at;
    const newEndAt = changes.endAt ?? current.end_at;
    const newNotes = changes.internalNotes === undefined ? current.internal_notes : changes.internalNotes;
    await client.appointments.update({ data: {
      end_at: newEndAt, internal_notes: newNotes, start_at: newStartAt, updated_by: actorUserId,
    }, where: { id: appointmentId } });
    if (changes.startAt) await client.appointment_events.create({ data: {
      appointment_id: appointmentId, event_type: "RESCHEDULED",
      new_end_at: newEndAt, new_start_at: newStartAt, new_status: current.status,
      performed_by: actorUserId, previous_end_at: current.end_at,
      previous_start_at: current.start_at, previous_status: current.status,
    } });
    if (changes.internalNotes !== undefined && changes.internalNotes !== current.internal_notes) {
      await client.appointment_events.create({ data: {
        appointment_id: appointmentId,
        details: changes.internalNotes ? "Notas internas actualizadas." : "Notas internas eliminadas.",
        event_type: "NOTES_UPDATED", new_status: current.status,
        performed_by: actorUserId, previous_status: current.status,
      } });
    }
    return { appointment: await findAppointmentByIdWithClient(client, appointmentId), conflict: null, currentStatus: current.status };
  }, { isolationLevel: "Serializable" });
}

export async function changeAppointmentStatus(appointmentId, allowedCurrentStatuses, statusData, actorUserId) {
  return prisma.$transaction(async (client) => {
    const current = await client.appointments.findUnique({ where: { id: appointmentId } });
    if (!current) return { appointment: null, currentStatus: null };
    if (!allowedCurrentStatuses.includes(current.status)) return { appointment: null, currentStatus: current.status };
    const isCancellation = statusData.status === "CANCELLED";
    await client.appointments.update({ data: {
      cancellation_reason: isCancellation ? statusData.cancellationReason : null,
      cancelled_at: isCancellation ? statusData.changedAt : null,
      status: statusData.status, updated_by: actorUserId,
    }, where: { id: appointmentId } });
    await client.appointment_events.create({ data: {
      appointment_id: appointmentId,
      details: isCancellation ? statusData.cancellationReason : null,
      event_type: isCancellation ? "CANCELLED" : "STATUS_CHANGED",
      new_status: statusData.status, performed_by: actorUserId,
      previous_status: current.status,
    } });
    return { appointment: await findAppointmentByIdWithClient(client, appointmentId), currentStatus: current.status };
  }, { isolationLevel: "Serializable" });
}

export async function getAppointmentHistory(appointmentId) {
  return (await prisma.appointment_events.findMany({
    include: { users: true }, orderBy: [{ created_at: "asc" }, { id: "asc" }],
    where: { appointment_id: appointmentId },
  })).map(mapEvent);
}
