export function canReadCommercialReports(actor) {
  return (actor?.permissions ?? []).some((permission) => ["reports.read", "sales.reports_read"].includes(permission));
}

export function dashboardResult(result) {
  return result.status === "fulfilled"
    ? { status: result.value === null ? "unavailable" : "ready", value: result.value }
    : { error: result.reason.message, status: "error", value: null };
}

export function metricValue(result, format) {
  if (!result) return "Cargando…";
  if (result.status === "unavailable") return "Sin acceso";
  if (result.status === "error") return "No disponible";
  return format(result.value);
}
