// Capa HTTP para health/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { getHealthStatus } from "@/services/health-service";

// GET /api/health/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET() {
  return executeApiHandler(async () => {
    return createSuccessResponse(await getHealthStatus());
  });
}
