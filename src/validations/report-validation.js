import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { AppError } from "../utils/app-error.js";
import { SALE_STATUSES } from "./sale-validation.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Summer time can skip midnight. Find the first instant of the local date.
function localDayStart(day) {
  const noon = fromZonedTime(`${day}T12:00:00`, "America/Santiago").getTime();
  let low = noon - 24 * 3600000, high = noon;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (formatInTimeZone(middle, "America/Santiago", "yyyy-MM-dd") < day) low = middle;
    else high = middle;
  }
  return new Date(high);
}
function fail(message) {
  throw new AppError({ code: "INVALID_REPORT_QUERY", message, status: 400 });
}
function date(value, label) {
  if (!DATE.test(value ?? "")) fail(`${label} debe usar AAAA-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    fail(`${label} no es válida.`);
  return value;
}

export function validateSalesReportQuery(
  searchParams,
  currentDate = new Date(),
) {
  const defaultTo = formatInTimeZone(currentDate, "America/Santiago", "yyyy-MM-dd");
  const defaultFromDate = new Date(`${defaultTo}T00:00:00.000Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
  const from = date(
    searchParams.get("from") ?? defaultFromDate.toISOString().slice(0, 10),
    "La fecha inicial",
  );
  const to = date(searchParams.get("to") ?? defaultTo, "La fecha final");
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (fromDate > toDate)
    fail("La fecha final debe ser igual o posterior a la inicial.");
  if ((toDate - fromDate) / 86400000 > 366)
    fail("El reporte no puede superar 366 días.");
  const status =
    (searchParams.get("status") ?? "").trim().toUpperCase() || null;
  const origin =
    (searchParams.get("origin") ?? "").trim().toUpperCase() || null;
  if (status && !SALE_STATUSES.includes(status))
    fail("El estado no es válido.");
  if (origin && !["IN_STORE", "ONLINE"].includes(origin))
    fail("El origen no es válido.");
  const endExclusive = new Date(toDate);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { from, fromDate: localDayStart(from), origin, status, to, toDate: localDayStart(endExclusive.toISOString().slice(0, 10)) };
}
