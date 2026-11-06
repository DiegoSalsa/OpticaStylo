import { AppError } from "../utils/app-error.js";
import { validateCustomerListQuery } from "./customer-validation.js";
import { fromZonedTime } from "date-fns-tz";
export const CONTACT_STATEMENT_VERSION = "STYLO-COMERCIAL-2026-10.v1";
export const CONTACT_STATEMENT = "Autoriza comunicaciones comerciales voluntarias por el canal seleccionado. Puede revocar esta autorización en cualquier momento. Comprar no implica aceptar publicidad.";
export function commercialError(message, code = "INVALID_COMMERCIAL_DATA", status = 400) {
  throw new AppError({
    code,
    message,
    status
  });
}
export function commercialText(value, max = 2000) {
  if (typeof value !== "string" || value.length > max || !value.trim()) commercialError(`Ingrese texto de hasta ${max} caracteres.`);
  return value.trim();
}
export function commercialQuery(params) {
  const base = validateCustomerListQuery(params),
    segment = params.get("segment") || "ALL",
    days = Number(params.get("days") ?? 365);
  if (!["ALL", "NEW", "PREVIOUS", "REPEAT", "INACTIVE", "QUOTED"].includes(segment) || !Number.isSafeInteger(days) || days < 1 || days > 3650) commercialError("El filtro comercial o período no es válido.");
  if (base.page > 100000) commercialError("La página excede el rango permitido.");
  return {
    ...base,
    segment,
    days
  };
}
export function preferencesInput(input) {
  if (!input || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) commercialError("Indique la versión del perfil que está editando.");
  const data = input.preferences;
  if (!data || Array.isArray(data) || typeof data !== "object" || Object.keys(data).some(k => !["brands", "models", "notes","preferredChannel"].includes(k))) commercialError("Registre solo preferencias comerciales explícitas.");
  if(data.preferredChannel!=null&&!["EMAIL","PHONE"].includes(data.preferredChannel))commercialError("El canal preferido no es válido.");
  const list = value => {
    if (!Array.isArray(value) || value.length > 20) commercialError("Registre hasta 20 preferencias por lista.");
    return [...new Set(value.map(v => commercialText(v, 100)))];
  };
  return {
    expectedVersion: input.expectedVersion,
    preferences: {
      brands: list(data.brands ?? []),
      models: list(data.models ?? []),
      notes: data.notes ? commercialText(data.notes, 1000) : null,
      ...(Object.hasOwn(data,"preferredChannel")?{preferredChannel:data.preferredChannel??null}:{})
    }
  };
}
export function contactInput(input, {
  self = false
} = {}) {
  if (!input || !["EMAIL", "PHONE"].includes(input.channel) || !["GRANTED", "REVOKED"].includes(input.decision)) commercialError("Seleccione canal y autorización o revocación.");
  if (input.decision === "GRANTED" && input.confirm !== true) commercialError("Confirme que existe una autorización expresa del cliente.");
  if (!self && !["IN_PERSON", "WRITTEN"].includes(input.source)) commercialError("Indique el origen de la autorización.");
  return {
    channel: input.channel,
    decision: input.decision,
    source: self ? "CUSTOMER_SELF" : input.source,
    evidence: input.evidence ? commercialText(input.evidence, 500) : null,
    statement_version: CONTACT_STATEMENT_VERSION
  };
}
export function commercialReportQuery(params) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const from = params.get("from") ?? today,
    to = params.get("to") ?? today;
  for (const value of [from, to]) {
    const parsed = new Date(value + "T00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) commercialError("Use fechas válidas AAAA-MM-DD.");
  }
  const end = new Date(to + "T00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  if (from > to || (new Date(to) - new Date(from)) / 86400000 > 366) commercialError("El período debe ser ordenado y de hasta 366 días.");
  return {
    from,
    to,
    fromDate: fromZonedTime(from + "T00:00:00", "America/Santiago"),
    toDate: fromZonedTime(end.toISOString().slice(0, 10) + "T00:00:00", "America/Santiago")
  };
}
