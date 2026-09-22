// Capa HTTP para store/booking/professionals/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { getPublicProfessionals } from "@/services/public-booking-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/booking/professionals/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET() {
  return executeApiHandler(async () => createSuccessResponse(await getPublicProfessionals()));
}
