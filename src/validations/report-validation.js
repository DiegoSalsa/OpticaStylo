import { AppError } from "../utils/app-error.js";
import { SALE_STATUSES } from "./sale-validation.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
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
  const defaultTo = currentDate.toISOString().slice(0, 10);
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
  return { from, fromDate, origin, status, to, toDate: endExclusive };
}
