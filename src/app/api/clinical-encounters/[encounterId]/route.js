import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getEncounter,
  updateEncounter,
} from "@/services/clinical-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeClinicalHandler as executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/clinical-encounters/[encounterId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const query=new URL(request.url).searchParams;
    const encounter = await getEncounter(encounterId, actor,{patientId:query.get("patientId"),revision:query.get("revision")});

    return createSuccessResponse(encounter);
  });
}

// PATCH /api/clinical-encounters/[encounterId]/ - actualizar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const input = await readJsonBody(request, 512 * 1024);
    const encounter = await updateEncounter(encounterId, input, actor);

    return createSuccessResponse(encounter);
  });
}
