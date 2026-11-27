import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

export const PROFESSIONAL_APPOINTMENT_EMAIL = "APPOINTMENT_PROFESSIONAL";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function professionalEmail(client, id) {
  const profile = await client.professional_profiles.findUnique({
    where: { user_id: id },
    select: { users_professional_profiles_user_idTousers: { select: { email: true, is_active: true } } },
  });
  const user = profile?.users_professional_profiles_user_idTousers;
  const email = user?.email?.trim().toLowerCase();
  return user?.is_active && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function enqueueProfessionalAppointmentEmail(client, { action, appointment, eventId, previous }) {
  const released = action === "released";
  const professionalId = released ? previous.professional_id : appointment.professional_id;
  const recipient = await professionalEmail(client, professionalId);
  if (!recipient) return;

  const key = transactionalEmailDeduplicationKey(
    PROFESSIONAL_APPOINTMENT_EMAIL, [appointment.id, eventId, professionalId].join(":"),
  );
  await client.transactional_email_outbox.upsert({
    where: { deduplication_key: key },
    update: {},
    create: {
      appointment_id: appointment.id,
      deduplication_key: key,
      template_code: PROFESSIONAL_APPOINTMENT_EMAIL,
      recipient_email: recipient,
      payload: {
        action,
        professionalId,
        startAt: (released ? previous.start_at : appointment.start_at).toISOString(),
        ...(!released && previous && { previousStartAt: previous.start_at.toISOString() }),
      },
    },
  });
}

export async function lockOutdatedAppointmentEmails(client, { id, professionalId, includePatientEmails }) {
  return client.$queryRaw`
    SELECT id, status, attempt_count, COALESCE(lock_expires_at > CURRENT_TIMESTAMP, false) AS active_claim
    FROM transactional_email_outbox
    WHERE appointment_id = ${id}::uuid
      AND (status IN ('PENDING', 'FAILED', 'PROCESSING')
        OR (status = 'DEAD_LETTER' AND template_code = ${PROFESSIONAL_APPOINTMENT_EMAIL}))
      AND (
        (${includePatientEmails} AND template_code IN ('APPOINTMENT_CONFIRMED', 'APPOINTMENT_REMINDER'))
        OR (template_code = ${PROFESSIONAL_APPOINTMENT_EMAIL}
          AND (payload->>'action' IS DISTINCT FROM 'released' OR payload->>'professionalId' = ${professionalId}))
      )
    ORDER BY id FOR UPDATE`;
}

export async function suppressOutdatedAppointmentEmails(client, emails, reason, now) {
  if (!emails.length) return;
  await client.transactional_email_outbox.updateMany({
    where: { id: { in: emails.map((email) => email.id) } },
    data: {
      status: "SUPPRESSED", skip_reason: reason, processing_finished_at: now,
      locked_at: null, locked_by: null, lock_expires_at: null,
    },
  });
  await client.transactional_email_transitions.createMany({
    data: emails.map((email) => ({
      email_id: email.id, from_status: email.status, to_status: "SUPPRESSED",
      attempt_count: email.attempt_count, reason_code: reason,
    })),
  });
}

export async function professionalAppointmentEmailEligibility(client, email, now) {
  const { action, professionalId, startAt } = email.payload ?? {};
  const validAction = ["confirmed", "rescheduled", "assigned", "released", "cancelled"].includes(action);
  const plannedStart = Date.parse(startAt);
  if (!email.appointmentId || !validAction || !UUID_PATTERN.test(professionalId) || !Number.isFinite(plannedStart)) {
    return { eligible: false, reason: "APPOINTMENT_INVALID_NOTICE" };
  }
  const appointment = await client.appointments.findUnique({
    where: { id: email.appointmentId },
    select: {
      professional_id: true, start_at: true, status: true,
      branch: { select: { name: true } },
      patients: { select: { first_names: true, last_names: true } },
    },
  });
  if (!appointment) return { eligible: false, reason: "APPOINTMENT_NOT_FOUND" };
  const assigned = appointment.professional_id === professionalId;
  const cancelled = action === "cancelled";
  const released = action === "released";
  const superseded = released ? assigned || plannedStart <= now.getTime()
    : !assigned || appointment.start_at.getTime() !== plannedStart
      || appointment.status !== (cancelled ? "CANCELLED" : "CONFIRMED")
      || (!cancelled && appointment.start_at <= now);
  if (superseded) return { eligible: false, reason: "APPOINTMENT_SUPERSEDED" };
  if (await professionalEmail(client, professionalId) !== email.recipientEmail) {
    return { eligible: false, reason: "APPOINTMENT_PROFESSIONAL_RECIPIENT_CHANGED" };
  }
  return {
    eligible: true,
    reason: null,
    payload: {
      appointmentId: email.appointmentId,
      branchName: appointment.branch?.name,
      patientName: !released && !cancelled
        ? [appointment.patients.first_names, appointment.patients.last_names].filter(Boolean).join(" ")
        : null,
    },
  };
}
