import { executeQuery, executeTransaction } from "../db/query.js";

function formatTime(value) {
  return value?.slice(0, 5) ?? null;
}

function formatDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function mapSchedule(row) {
  return {
    breakEnd: formatTime(row.break_end),
    breakStart: formatTime(row.break_start),
    dayOfWeek: row.day_of_week,
    endTime: formatTime(row.end_time),
    isWorking: row.is_working,
    startTime: formatTime(row.start_time),
  };
}

function mapOverride(row) {
  if (!row) {
    return null;
  }

  return {
    breakEnd: formatTime(row.break_end),
    breakStart: formatTime(row.break_start),
    date: formatDate(row.date),
    endTime: formatTime(row.end_time),
    isWorking: row.is_working,
    startTime: formatTime(row.start_time),
  };
}

function mapBlock(row) {
  return {
    createdAt: row.created_at,
    endAt: row.end_at,
    id: row.id,
    reason: row.reason,
    startAt: row.start_at,
  };
}

export async function getWeeklySchedule(professionalId) {
  const result = await executeQuery(
    `
      SELECT day_of_week, start_time, end_time, is_working, break_start, break_end
      FROM professional_weekly_schedules
      WHERE professional_id = $1
      ORDER BY day_of_week
    `,
    [professionalId],
  );

  return result.rows.map(mapSchedule);
}

export async function saveWeeklySchedule(professionalId, days) {
  return executeTransaction(async (client) => {
    for (const day of days) {
      await client.query(
        `
          INSERT INTO professional_weekly_schedules (
            professional_id,
            day_of_week,
            start_time,
            end_time,
            is_working,
            break_start,
            break_end
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (professional_id, day_of_week) DO UPDATE
          SET
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            is_working = EXCLUDED.is_working,
            break_start = EXCLUDED.break_start,
            break_end = EXCLUDED.break_end
        `,
        [
          professionalId,
          day.dayOfWeek,
          day.startTime,
          day.endTime,
          day.isWorking,
          day.breakStart,
          day.breakEnd,
        ],
      );
    }

    const result = await client.query(
      `
        SELECT day_of_week, start_time, end_time, is_working, break_start, break_end
        FROM professional_weekly_schedules
        WHERE professional_id = $1
        ORDER BY day_of_week
      `,
      [professionalId],
    );

    return result.rows.map(mapSchedule);
  });
}

export async function getScheduleOverrides(professionalId, from, to) {
  const result = await executeQuery(
    `
      SELECT date, start_time, end_time, is_working, break_start, break_end
      FROM professional_schedule_overrides
      WHERE professional_id = $1 AND date BETWEEN $2 AND $3
      ORDER BY date
    `,
    [professionalId, from, to],
  );

  return result.rows.map(mapOverride);
}

export async function findScheduleOverride(professionalId, date) {
  const result = await executeQuery(
    `
      SELECT date, start_time, end_time, is_working, break_start, break_end
      FROM professional_schedule_overrides
      WHERE professional_id = $1 AND date = $2
    `,
    [professionalId, date],
  );

  return mapOverride(result.rows[0]);
}

export async function upsertScheduleOverride(
  professionalId,
  date,
  override,
  actorUserId,
) {
  const result = await executeQuery(
    `
      INSERT INTO professional_schedule_overrides (
        professional_id,
        date,
        start_time,
        end_time,
        is_working,
        break_start,
        break_end,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (professional_id, date) DO UPDATE
      SET
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        is_working = EXCLUDED.is_working,
        break_start = EXCLUDED.break_start,
        break_end = EXCLUDED.break_end
      RETURNING date, start_time, end_time, is_working, break_start, break_end
    `,
    [
      professionalId,
      date,
      override.startTime,
      override.endTime,
      override.isWorking,
      override.breakStart,
      override.breakEnd,
      actorUserId,
    ],
  );

  return mapOverride(result.rows[0]);
}

export async function removeScheduleOverride(professionalId, date) {
  const result = await executeQuery(
    `
      DELETE FROM professional_schedule_overrides
      WHERE professional_id = $1 AND date = $2
    `,
    [professionalId, date],
  );

  return result.rowCount > 0;
}

export async function createScheduleBlock(
  professionalId,
  block,
  actorUserId,
) {
  return executeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      professionalId,
    ]);

    const appointmentResult = await client.query(
      `
        SELECT id
        FROM appointments
        WHERE
          professional_id = $1
          AND status <> 'CANCELLED'
          AND start_at < $3
          AND end_at > $2
        LIMIT 1
      `,
      [professionalId, block.startAt, block.endAt],
    );

    if (appointmentResult.rowCount > 0) {
      return { block: null, conflict: "APPOINTMENT" };
    }

    const result = await client.query(
      `
        INSERT INTO professional_schedule_blocks (
          professional_id,
          start_at,
          end_at,
          reason,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, start_at, end_at, reason, created_at
      `,
      [professionalId, block.startAt, block.endAt, block.reason, actorUserId],
    );

    return { block: mapBlock(result.rows[0]), conflict: null };
  });
}

export async function getScheduleBlocks(professionalId, from, to) {
  const result = await executeQuery(
    `
      SELECT id, start_at, end_at, reason, created_at
      FROM professional_schedule_blocks
      WHERE
        professional_id = $1
        AND start_at < $3
        AND end_at > $2
      ORDER BY start_at, id
    `,
    [professionalId, from, to],
  );

  return result.rows.map(mapBlock);
}

export async function removeScheduleBlock(professionalId, blockId) {
  const result = await executeQuery(
    `
      DELETE FROM professional_schedule_blocks
      WHERE professional_id = $1 AND id = $2
    `,
    [professionalId, blockId],
  );

  return result.rowCount > 0;
}
