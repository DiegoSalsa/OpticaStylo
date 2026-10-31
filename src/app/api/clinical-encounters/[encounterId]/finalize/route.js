import { authenticateRequest } from "@/auth/authenticate-request";
import { finalizeEncounter } from "@/services/clinical-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeClinicalHandler as executeApiHandler } from "@/utils/error-handler";
import {readJsonBody} from "@/utils/http-request";

// POST /api/clinical-encounters/[encounterId]/finalize/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const encounter = await finalizeEncounter(encounterId, await readJsonBody(request), actor);

    return createSuccessResponse(encounter);
  });
}
