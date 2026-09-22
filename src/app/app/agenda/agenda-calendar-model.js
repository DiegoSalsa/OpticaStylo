// Código de la aplicación para agenda-calendar-model.
const CLINICAL_READ_PERMISSION = "medical_records.read_assigned";

// Centralizar la lógica de date at noon para mantener consistente el comportamiento de la aplicación
function dateAtNoon(value) {
  return new Date(`${value}T12:00:00Z`);
}

// Centralizar la lógica de date key para mantener consistente el comportamiento de la aplicación
function dateKey(value, timeZone) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date(value));
}

// Crear o registrar add calendar days aplicando las reglas de negocio y persistencia correspondientes
export function addCalendarDays(value, amount) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

// Transformar build agenda days al formato utilizado por el resto de la aplicación
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

// Determinar si can open clínica record cumple la condición requerida por la aplicación
export function canOpenClinicalRecord(actor, appointment) {
  return Boolean(
    actor?.permissions?.includes(CLINICAL_READ_PERMISSION) &&
      ["CHECKED_IN", "COMPLETED"].includes(appointment?.status),
  );
}

// Centralizar la lógica de clínica record href para mantener consistente el comportamiento de la aplicación
export function clinicalRecordHref(appointmentId) {
  return `/app/ficha-clinica?appointmentId=${encodeURIComponent(appointmentId)}`;
}
