import { prisma } from "../db/prisma.js";

function formatTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  return value.slice(0, 5);
}

function time(value) {
  return value ? new Date(`1970-01-01T${value}:00.000Z`) : null;
}

function dateOnly(value) {
  return value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function mapSchedule(row) {
  return {
    breakEnd: formatTime(row.break_end), breakStart: formatTime(row.break_start),
    dayOfWeek: row.day_of_week, endTime: formatTime(row.end_time),
    isWorking: row.is_working, startTime: formatTime(row.start_time),
  };
}

function mapOverride(row) {
  if (!row) return null;
  return {
    breakEnd: formatTime(row.break_end), breakStart: formatTime(row.break_start),
    date: formatDate(row.date), endTime: formatTime(row.end_time),
    isWorking: row.is_working, startTime: formatTime(row.start_time),
  };
}

function mapBlock(row) {
  return row ? { createdAt: row.created_at, endAt: row.end_at, id: row.id, reason: row.reason, startAt: row.start_at } : null;
}

export async function getWeeklySchedule(professionalId) {
  return (await prisma.professional_weekly_schedules.findMany({
    orderBy: { day_of_week: "asc" }, where: { professional_id: professionalId },
  })).map(mapSchedule);
}

export async function saveWeeklySchedule(professionalId, days) {
  return prisma.$transaction(async (client) => {
    for (const day of days) {
      const data = {
        break_end: time(day.breakEnd), break_start: time(day.breakStart),
        end_time: time(day.endTime), is_working: day.isWorking, start_time: time(day.startTime),
      };
      await client.professional_weekly_schedules.upsert({
        create: { ...data, day_of_week: day.dayOfWeek, professional_id: professionalId },
        update: data,
        where: { professional_id_day_of_week: { day_of_week: day.dayOfWeek, professional_id: professionalId } },
      });
    }
    return (await client.professional_weekly_schedules.findMany({
      orderBy: { day_of_week: "asc" }, where: { professional_id: professionalId },
    })).map(mapSchedule);
  });
}

export async function getScheduleOverrides(professionalId, from, to) {
  return (await prisma.professional_schedule_overrides.findMany({
    orderBy: { date: "asc" },
    where: { date: { gte: dateOnly(from), lte: dateOnly(to) }, professional_id: professionalId },
  })).map(mapOverride);
}

export async function findScheduleOverride(professionalId, date) {
  return mapOverride(await prisma.professional_schedule_overrides.findUnique({
    where: { professional_id_date: { date: dateOnly(date), professional_id: professionalId } },
  }));
}

export async function upsertScheduleOverride(professionalId, date, override, actorUserId) {
  const data = {
    break_end: time(override.breakEnd), break_start: time(override.breakStart),
    end_time: time(override.endTime), is_working: override.isWorking, start_time: time(override.startTime),
  };
  return mapOverride(await prisma.professional_schedule_overrides.upsert({
    create: { ...data, created_by: actorUserId, date: dateOnly(date), professional_id: professionalId },
    update: data,
    where: { professional_id_date: { date: dateOnly(date), professional_id: professionalId } },
  }));
}

export async function removeScheduleOverride(professionalId, date) {
  const result = await prisma.professional_schedule_overrides.deleteMany({
    where: { date: dateOnly(date), professional_id: professionalId },
  });
  return result.count > 0;
}

export async function createScheduleBlock(professionalId, block, actorUserId) {
  return prisma.$transaction(async (client) => {
    const conflict = await client.appointments.findFirst({
      select: { id: true },
      where: {
        end_at: { gt: block.startAt }, professional_id: professionalId,
        start_at: { lt: block.endAt }, status: { not: "CANCELLED" },
      },
    });
    if (conflict) return { block: null, conflict: "APPOINTMENT" };
    const created = await client.professional_schedule_blocks.create({ data: {
      created_by: actorUserId, end_at: block.endAt, professional_id: professionalId,
      reason: block.reason, start_at: block.startAt,
    } });
    return { block: mapBlock(created), conflict: null };
  }, { isolationLevel: "Serializable" });
}

export async function getScheduleBlocks(professionalId, from, to) {
  return (await prisma.professional_schedule_blocks.findMany({
    orderBy: [{ start_at: "asc" }, { id: "asc" }],
    where: { end_at: { gt: from }, professional_id: professionalId, start_at: { lt: to } },
  })).map(mapBlock);
}

export async function removeScheduleBlock(professionalId, blockId) {
  return (await prisma.professional_schedule_blocks.deleteMany({
    where: { id: blockId, professional_id: professionalId },
  })).count > 0;
}
