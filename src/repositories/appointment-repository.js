import { executeQuery, executeTransaction } from "../db/query.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

function mapAppointment(row) {
  if (!row) {
    return null;
  }

  return {
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    endAt: row.end_at,
    id: row.id,
    internalNotes: row.internal_notes,
    patient: {
      firstNames: row.patient_first_names,
      id: row.patient_id,
      lastNames: row.patient_last_names,
      rut: row.patient_rut,
    },
    professional: {
      firstName: row.professional_first_name,
      id: row.professional_id,
      lastName: row.professional_last_name,
    },
    source: row.source,
    startAt: row.start_at,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row) {
  return {
    createdAt: row.created_at,
    details: row.details,
    eventType: row.event_type,
    id: Number(row.id),
    newEndAt: row.new_end_at,
    newStartAt: row.new_start_at,
    newStatus: row.new_status,
    performedBy: row.performed_by ? {
      firstName: row.performed_by_first_name,
      id: row.performed_by,
      lastName: row.performed_by_last_name,
    } : null,
    previousEndAt: row.previous_end_at,
    previousStartAt: row.previous_start_at,
    previousStatus: row.previous_status,
  };
}

const APPOINTMENT_SELECT = `
  SELECT
    appointments.id,
    appointments.patient_id,
    appointments.professional_id,
    appointments.start_at,
    appointments.end_at,
    appointments.status,
    appointments.internal_notes,
    appointments.cancellation_reason,
    appointments.cancelled_at,
    appointments.created_at,
    appointments.updated_at,
    appointments.source,
    patients.rut AS patient_rut,
    patients.first_names AS patient_first_names,
    patients.last_names AS patient_last_names,
    professional_users.first_name AS professional_first_name,
    professional_users.last_name AS professional_last_name
  FROM appointments
  JOIN patients ON patients.id = appointments.patient_id
  JOIN users AS professional_users
    ON professional_users.id = appointments.professional_id
`;

async function findAppointmentByIdWithClient(client, appointmentId) {
  const result = await client.query(
    `${APPOINTMENT_SELECT} WHERE appointments.id = $1`,
    [appointmentId],
  );

  return mapAppointment(result.rows[0]);
}

async function enqueueAppointmentEmails(
  client,
  { appointmentId, endAt, recipientEmail, reminderHours, startAt },
) {
  const payload = JSON.stringify({ appointmentId, endAt, startAt });
  await client.query(
    `INSERT INTO transactional_email_outbox (
       template_code, recipient_email, payload, deduplication_key,
       appointment_id
     ) VALUES ('APPOINTMENT_CONFIRMED', $1, $2::JSONB, $3, $4)
     ON CONFLICT (deduplication_key) DO NOTHING`,
    [recipientEmail, payload,
      transactionalEmailDeduplicationKey("APPOINTMENT_CONFIRMED", appointmentId),
      appointmentId],
  );
  const reminderAt = new Date(startAt.getTime() - reminderHours * 60 * 60 * 1_000);
  await client.query(
    `INSERT INTO transactional_email_outbox (
       template_code, recipient_email, payload, deduplication_key,
       scheduled_at, next_attempt_at, appointment_id
     ) VALUES (
       'APPOINTMENT_REMINDER', $1, $2::JSONB, $3,
       GREATEST($4, CURRENT_TIMESTAMP), GREATEST($4, CURRENT_TIMESTAMP), $5
     )
     ON CONFLICT (deduplication_key) DO NOTHING`,
    [recipientEmail, payload,
      transactionalEmailDeduplicationKey("APPOINTMENT_REMINDER", appointmentId),
      reminderAt, appointmentId],
  );
}

async function findCollision(
  client,
  professionalId,
  startAt,
  endAt,
  excludedAppointmentId = null,
) {
  const [appointmentResult, blockResult] = await Promise.all([
    client.query(
      `
        SELECT id
        FROM appointments
        WHERE
          professional_id = $1
          AND status <> 'CANCELLED'
          AND start_at < $3
          AND end_at > $2
          AND ($4::uuid IS NULL OR id <> $4)
        LIMIT 1
      `,
      [professionalId, startAt, endAt, excludedAppointmentId],
    ),
    client.query(
      `
        SELECT id
        FROM professional_schedule_blocks
        WHERE
          professional_id = $1
          AND start_at < $3
          AND end_at > $2
        LIMIT 1
      `,
      [professionalId, startAt, endAt],
    ),
  ]);

  if (appointmentResult.rowCount > 0) {
    return "APPOINTMENT";
  }

  return blockResult.rowCount > 0 ? "SCHEDULE_BLOCK" : null;
}

export async function findAppointmentById(appointmentId) {
  return findAppointmentByIdWithClient(
    { query: (text, parameters) => executeQuery(text, parameters) },
    appointmentId,
  );
}

export async function listAppointments({
  from,
  ownProfessionalId,
  patientId,
  professionalId,
  status,
  to,
}) {
  const result = await executeQuery(
    `
      ${APPOINTMENT_SELECT}
      WHERE
        appointments.start_at < $2
        AND appointments.end_at > $1
        AND ($3::uuid IS NULL OR appointments.patient_id = $3)
        AND ($4::uuid IS NULL OR appointments.professional_id = $4)
        AND ($5::varchar IS NULL OR appointments.status = $5)
        AND ($6::uuid IS NULL OR appointments.professional_id = $6)
      ORDER BY appointments.start_at, appointments.id
    `,
    [from, to, patientId, professionalId, status, ownProfessionalId],
  );

  return result.rows.map(mapAppointment);
}

export async function getBusyAppointments(
  professionalId,
  from,
  to,
  excludedAppointmentId = null,
) {
  const result = await executeQuery(
    `
      SELECT start_at, end_at
      FROM appointments
      WHERE
        professional_id = $1
        AND status <> 'CANCELLED'
        AND start_at < $3
        AND end_at > $2
        AND ($4::uuid IS NULL OR id <> $4)
      ORDER BY start_at, id
    `,
    [professionalId, from, to, excludedAppointmentId],
  );

  return result.rows.map((row) => ({
    endAt: row.end_at,
    startAt: row.start_at,
  }));
}

export async function createAppointment(appointmentData, actorUserId, options = {}) {
  return executeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      appointmentData.professionalId,
    ]);

    const conflict = await findCollision(
      client,
      appointmentData.professionalId,
      appointmentData.startAt,
      appointmentData.endAt,
    );

    if (conflict) {
      return { appointment: null, conflict };
    }

    const result = await client.query(
      `
        INSERT INTO appointments (
          patient_id,
          professional_id,
          start_at,
          end_at,
          internal_notes,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        RETURNING id
      `,
      [
        appointmentData.patientId,
        appointmentData.professionalId,
        appointmentData.startAt,
        appointmentData.endAt,
        appointmentData.internalNotes,
        actorUserId,
      ],
    );
    const appointmentId = result.rows[0].id;

    await client.query(
      `
        INSERT INTO appointment_events (
          appointment_id,
          event_type,
          new_start_at,
          new_end_at,
          new_status,
          performed_by
        )
        VALUES ($1, 'CREATED', $2, $3, 'CONFIRMED', $4)
      `,
      [
        appointmentId,
        appointmentData.startAt,
        appointmentData.endAt,
        actorUserId,
      ],
    );

    const patientResult = await client.query(
      "SELECT email FROM patients WHERE id = $1",
      [appointmentData.patientId],
    );
    await enqueueAppointmentEmails(client, {
      appointmentId,
      endAt: appointmentData.endAt,
      recipientEmail: patientResult.rows[0].email,
      reminderHours: options.reminderHours ?? 24,
      startAt: appointmentData.startAt,
    });

    return {
      appointment: await findAppointmentByIdWithClient(client, appointmentId),
      conflict: null,
    };
  });
}

export async function createPublicBooking(bookingData, options = {}) {
  return executeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      bookingData.patient.rut,
    ]);
    const patientResult = await client.query(
      `SELECT id, birth_date, email FROM patients WHERE rut = $1 FOR UPDATE`,
      [bookingData.patient.rut],
    );
    let patientId = patientResult.rows[0]?.id;

    if (patientId) {
      const existing = patientResult.rows[0];
      const birthDate = existing.birth_date instanceof Date
        ? existing.birth_date.toISOString().slice(0, 10)
        : String(existing.birth_date);
      if (birthDate !== bookingData.patient.birthDate || existing.email !== bookingData.patient.email) {
        return { appointment: null, conflict: "IDENTITY" };
      }
    } else {
      const createdPatient = await client.query(
        `INSERT INTO patients (
          rut, first_names, last_names, birth_date, phone, email, address,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
        RETURNING id`,
        [
          bookingData.patient.rut,
          bookingData.patient.firstNames,
          bookingData.patient.lastNames,
          bookingData.patient.birthDate,
          bookingData.patient.phone,
          bookingData.patient.email,
          bookingData.patient.address,
        ],
      );
      patientId = createdPatient.rows[0].id;

      if (bookingData.patient.guardian) {
        const guardian = bookingData.patient.guardian;
        await client.query(
          `INSERT INTO patient_guardians (
            patient_id, rut, first_names, last_names, relationship, phone, email
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [patientId, guardian.rut, guardian.firstNames, guardian.lastNames,
            guardian.relationship, guardian.phone, guardian.email],
        );
      }
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      bookingData.professionalId,
    ]);
    const conflict = await findCollision(
      client,
      bookingData.professionalId,
      bookingData.startAt,
      bookingData.endAt,
    );
    if (conflict) return { appointment: null, conflict };

    const appointmentResult = await client.query(
      `INSERT INTO appointments (
        patient_id, professional_id, start_at, end_at, source,
        public_manage_token_hash, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, 'PUBLIC', $5, NULL, NULL)
      RETURNING id`,
      [patientId, bookingData.professionalId, bookingData.startAt,
        bookingData.endAt, bookingData.manageTokenHash],
    );
    const appointmentId = appointmentResult.rows[0].id;

    await client.query(
      `INSERT INTO appointment_events (
        appointment_id, event_type, new_start_at, new_end_at, new_status, performed_by
      ) VALUES ($1, 'CREATED', $2, $3, 'CONFIRMED', NULL)`,
      [appointmentId, bookingData.startAt, bookingData.endAt],
    );

    await enqueueAppointmentEmails(client, {
      appointmentId,
      endAt: bookingData.endAt,
      recipientEmail: bookingData.patient.email,
      reminderHours: options.reminderHours ?? 24,
      startAt: bookingData.startAt,
    });

    return {
      appointment: await findAppointmentByIdWithClient(client, appointmentId),
      conflict: null,
    };
  });
}

export async function updateAppointment(
  appointmentId,
  changes,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    const currentResult = await client.query(
      `
        SELECT id, professional_id, start_at, end_at, status, internal_notes
        FROM appointments
        WHERE id = $1
        FOR UPDATE
      `,
      [appointmentId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      return { appointment: null, conflict: null, currentStatus: null };
    }

    if (current.status !== "CONFIRMED") {
      return {
        appointment: null,
        conflict: null,
        currentStatus: current.status,
      };
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      current.professional_id,
    ]);

    if (changes.startAt) {
      const conflict = await findCollision(
        client,
        current.professional_id,
        changes.startAt,
        changes.endAt,
        appointmentId,
      );

      if (conflict) {
        return { appointment: null, conflict, currentStatus: current.status };
      }
    }

    const newStartAt = changes.startAt ?? current.start_at;
    const newEndAt = changes.endAt ?? current.end_at;
    const newInternalNotes =
      changes.internalNotes === undefined
        ? current.internal_notes
        : changes.internalNotes;

    await client.query(
      `
        UPDATE appointments
        SET
          start_at = $2,
          end_at = $3,
          internal_notes = $4,
          updated_by = $5
        WHERE id = $1
      `,
      [appointmentId, newStartAt, newEndAt, newInternalNotes, actorUserId],
    );

    if (changes.startAt) {
      await client.query(
        `
          INSERT INTO appointment_events (
            appointment_id,
            event_type,
            previous_start_at,
            new_start_at,
            previous_end_at,
            new_end_at,
            previous_status,
            new_status,
            performed_by
          )
          VALUES ($1, 'RESCHEDULED', $2, $3, $4, $5, $6, $6, $7)
        `,
        [
          appointmentId,
          current.start_at,
          newStartAt,
          current.end_at,
          newEndAt,
          current.status,
          actorUserId,
        ],
      );
    }

    if (
      changes.internalNotes !== undefined &&
      changes.internalNotes !== current.internal_notes
    ) {
      await client.query(
        `
          INSERT INTO appointment_events (
            appointment_id,
            event_type,
            previous_status,
            new_status,
            details,
            performed_by
          )
          VALUES ($1, 'NOTES_UPDATED', $2, $2, $3, $4)
        `,
        [
          appointmentId,
          current.status,
          changes.internalNotes ? "Notas internas actualizadas." : "Notas internas eliminadas.",
          actorUserId,
        ],
      );
    }

    return {
      appointment: await findAppointmentByIdWithClient(client, appointmentId),
      conflict: null,
      currentStatus: current.status,
    };
  });
}

export async function changeAppointmentStatus(
  appointmentId,
  allowedCurrentStatuses,
  statusData,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    const currentResult = await client.query(
      `
        SELECT id, status
        FROM appointments
        WHERE id = $1
        FOR UPDATE
      `,
      [appointmentId],
    );
    const current = currentResult.rows[0];

    if (!current) {
      return { appointment: null, currentStatus: null };
    }

    if (!allowedCurrentStatuses.includes(current.status)) {
      return { appointment: null, currentStatus: current.status };
    }

    const isCancellation = statusData.status === "CANCELLED";

    await client.query(
      `
        UPDATE appointments
        SET
          status = $2,
          cancellation_reason = $3,
          cancelled_at = $4,
          updated_by = $5
        WHERE id = $1
      `,
      [
        appointmentId,
        statusData.status,
        isCancellation ? statusData.cancellationReason : null,
        isCancellation ? statusData.changedAt : null,
        actorUserId,
      ],
    );

    await client.query(
      `
        INSERT INTO appointment_events (
          appointment_id,
          event_type,
          previous_status,
          new_status,
          details,
          performed_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        appointmentId,
        isCancellation ? "CANCELLED" : "STATUS_CHANGED",
        current.status,
        statusData.status,
        isCancellation ? statusData.cancellationReason : null,
        actorUserId,
      ],
    );

    return {
      appointment: await findAppointmentByIdWithClient(client, appointmentId),
      currentStatus: current.status,
    };
  });
}

export async function getAppointmentHistory(appointmentId) {
  const result = await executeQuery(
    `
      SELECT
        appointment_events.id,
        appointment_events.event_type,
        appointment_events.previous_start_at,
        appointment_events.new_start_at,
        appointment_events.previous_end_at,
        appointment_events.new_end_at,
        appointment_events.previous_status,
        appointment_events.new_status,
        appointment_events.details,
        appointment_events.performed_by,
        appointment_events.created_at,
        users.first_name AS performed_by_first_name,
        users.last_name AS performed_by_last_name
      FROM appointment_events
      LEFT JOIN users ON users.id = appointment_events.performed_by
      WHERE appointment_events.appointment_id = $1
      ORDER BY appointment_events.created_at, appointment_events.id
    `,
    [appointmentId],
  );

  return result.rows.map(mapEvent);
}
