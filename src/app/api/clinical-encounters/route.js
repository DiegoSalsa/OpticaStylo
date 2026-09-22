// Capa HTTP para clinical-encounters/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { createEncounter, getEncounterForAppointment } from "@/services/clinical-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/clinical-encounters/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const appointmentId = new URL(request.url).searchParams.get("appointmentId");
    return createSuccessResponse(await getEncounterForAppointment(appointmentId, actor));
  });
}

// POST /api/clinical-encounters/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const input = await readJsonBody(request, 64 * 1024);
    const encounter = await createEncounter(input, actor);

    return createSuccessResponse(encounter, { status: 201 });
  });
}
