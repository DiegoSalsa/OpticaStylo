import { formatInTimeZone } from "date-fns-tz";
import { AppError } from "./app-error.js";

export function adultBirthDateCutoff(now = new Date()) {
  const date = new Date(formatInTimeZone(now, "America/Santiago", "yyyy-MM-dd") + "T00:00:00.000Z");
  date.setUTCFullYear(date.getUTCFullYear() - 18);
  return date;
}

export function isAdultBirthDate(value, now = new Date()) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date <= adultBirthDateCutoff(now);
}

export function validateAccountBirthDate(value, now = new Date()) {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T00:00:00.000Z") : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError({ code: "INVALID_ACCOUNT_BIRTH_DATE", message: "Ingresa una fecha de nacimiento válida.", status: 400 });
  }
  if (!isAdultBirthDate(date, now)) {
    throw new AppError({ code: "ADULT_ACCOUNT_REQUIRED", message: "La cuenta debe pertenecer a una persona mayor de 18 años. Los menores se registran en Menores a mi cargo dentro de la cuenta del adulto responsable.", status: 400 });
  }
  return value;
}
