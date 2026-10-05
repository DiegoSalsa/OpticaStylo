const CLINICAL_READ_PERMISSION = "medical_records.read_assigned";

function dateAtNoon(value) {
  return new Date(`${value}T12:00:00Z`);
}

function dateKey(value, timeZone) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date(value));
}

export function addCalendarDays(value, amount) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function buildAgendaDays({
  appointments = [],
  blocks = [],
  from,
  schedule = [],
  timeZone = "America/Santiago",
  to,
}) {
  const days = [];
  let current = from;

  while (current <= to) {
    const dayOfWeek = dateAtNoon(current).getUTCDay();
    const workingDay = schedule.find((item) => item.dayOfWeek === dayOfWeek);
    const entries = [
      ...appointments
        .filter((item) => dateKey(item.startAt, timeZone) === current)
        .map((item) => ({ ...item, kind: "appointment" })),
      ...blocks
        .filter((item) => dateKey(item.startAt, timeZone) === current)
        .map((item) => ({ ...item, kind: "block" })),
    ].sort((left, right) => new Date(left.startAt) - new Date(right.startAt));

    days.push({
      date: current,
      entries,
      schedule: workingDay ?? { isWorking: false },
    });
    current = addCalendarDays(current, 1);
  }

  return days;
}

export function canOpenClinicalRecord(actor, appointment) {
  return Boolean(
    actor?.permissions?.includes(CLINICAL_READ_PERMISSION) &&
      ["CHECKED_IN", "COMPLETED"].includes(appointment?.status),
  );
}

export function clinicalRecordHref(appointmentId) {
  return `/app/ficha-clinica?appointmentId=${encodeURIComponent(appointmentId)}`;
}
