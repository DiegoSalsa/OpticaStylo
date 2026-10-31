// Capa HTTP para clinical-encounters/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { createEncounter, getEncounterForAppointment } from "@/services/clinical-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeClinicalHandler as executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import {readIdempotencyKey} from "@/utils/idempotency-key";

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
    const input = await readJsonBody(request, 512 * 1024);
    const encounter = await createEncounter(input, actor,{requestKey:readIdempotencyKey(request)});

    return createSuccessResponse(encounter, { status: 201 });
  });
}
