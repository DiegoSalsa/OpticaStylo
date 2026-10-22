import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEMO_TIME_ZONE = "America/Santiago";

// Sin fecha explícita se prepara el día siguiente en Chile, aunque el host esté en UTC.
export function demoDate(value, now = new Date()) {
  if (value == null || value === "") {
    const today = formatInTimeZone(now, DEMO_TIME_ZONE, "yyyy-MM-dd");
    return addDemoDays(today, 1);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("DEMO_DATE debe ser una fecha válida en formato AAAA-MM-DD.");
  }
  return value;
}

// Sumar días civiles sin depender de los cambios de horario de verano.
export function addDemoDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Resolver la zona IANA en cada fecha; Chile no usa -03:00 durante todo el año.
export function demoInstant(date, time) {
  return fromZonedTime(`${date}T${time}:00`, DEMO_TIME_ZONE);
}
