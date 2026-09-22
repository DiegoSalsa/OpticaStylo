// Servicio de negocio que coordina reglas, permisos y persistencia de report-service.
import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { getSalesReportData } from "../repositories/report-repository.js";
import { validateSalesReportQuery } from "../validations/report-validation.js";

// Consultar get ventas reporte y devolver los datos en el formato esperado por la capa llamadora
export async function getSalesReport(searchParams, actor, dependencies = {}) {
  const canReadSalesReport = (actor?.permissions ?? []).some((permission) =>
    [PERMISSIONS.REPORTS_READ, PERMISSIONS.SALES_REPORTS_READ].includes(permission));
  if (!canReadSalesReport) requirePermissions(actor, [PERMISSIONS.REPORTS_READ]);
  const query = validateSalesReportQuery(
    searchParams,
    dependencies.currentDate,
  );
  return {
    filters: {
      from: query.from,
      origin: query.origin,
      status: query.status,
      to: query.to,
    },
    ...(await (dependencies.getSalesReportData ?? getSalesReportData)(query)),
  };
}
