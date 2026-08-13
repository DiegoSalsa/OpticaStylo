import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function getDayOfWeek(date, timeZone) {
  const noonUtc = fromZonedTime(`${date}T12:00:00`, timeZone);
  return noonUtc.getUTCDay();
}

export function buildAvailabilitySlots({
  appointmentDurationMinutes,
  blocks = [],
  date,
  isBookable,
  now = new Date(),
  override = null,
  slotIntervalMinutes,
  timeZone,
  weeklySchedule = [],
}) {
  if (!isBookable) {
    return [];
  }

  const schedule =
    override ??
    weeklySchedule.find(
      (day) => day.dayOfWeek === getDayOfWeek(date, timeZone),
    );

  if (!schedule?.isWorking || !schedule.startTime || !schedule.endTime) {
    return [];
  }

  const opensAt = fromZonedTime(`${date}T${schedule.startTime}:00`, timeZone);
  const closesAt = fromZonedTime(`${date}T${schedule.endTime}:00`, timeZone);
  const breakStart = schedule.breakStart
    ? fromZonedTime(`${date}T${schedule.breakStart}:00`, timeZone)
    : null;
  const breakEnd = schedule.breakEnd
    ? fromZonedTime(`${date}T${schedule.breakEnd}:00`, timeZone)
    : null;
  const slots = [];

  for (
    let startAt = opensAt;
    addMinutes(startAt, appointmentDurationMinutes) <= closesAt;
    startAt = addMinutes(startAt, slotIntervalMinutes)
  ) {
    const endAt = addMinutes(startAt, appointmentDurationMinutes);
    const overlapsBreak =
      breakStart && breakEnd
        ? overlaps(startAt, endAt, breakStart, breakEnd)
        : false;
    const overlapsBlock = blocks.some((block) =>
      overlaps(startAt, endAt, new Date(block.startAt), new Date(block.endAt)),
    );

    if (startAt > now && !overlapsBreak && !overlapsBlock) {
      slots.push({
        endAt: endAt.toISOString(),
        startAt: startAt.toISOString(),
      });
    }
  }

  return slots;
}
