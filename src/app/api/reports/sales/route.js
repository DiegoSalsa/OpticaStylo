// Capa HTTP para reports/sales/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { getSalesReport } from "@/services/report-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/reports/sales/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () =>
    createSuccessResponse(
      await getSalesReport(
        new URL(request.url).searchParams,
        await authenticateRequest(request),
      ),
    ),
  );
}
