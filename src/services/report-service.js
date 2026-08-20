import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { getSalesReportData } from "../repositories/report-repository.js";
import { validateSalesReportQuery } from "../validations/report-validation.js";

export async function getSalesReport(searchParams, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.REPORTS_READ]);
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
