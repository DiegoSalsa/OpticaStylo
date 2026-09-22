// Capa HTTP para prescriptions/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { getPrescriptionList } from "@/services/prescription-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/prescriptions/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const prescriptions = await getPrescriptionList(
      new URL(request.url).searchParams,
      actor,
    );

    return createSuccessResponse(prescriptions);
  });
}
