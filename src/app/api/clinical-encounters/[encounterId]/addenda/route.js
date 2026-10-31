import { authenticateRequest } from "@/auth/authenticate-request";
import { addEncounterAddendum } from "@/services/clinical-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeClinicalHandler as executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import {readIdempotencyKey} from "@/utils/idempotency-key";

// POST /api/clinical-encounters/[encounterId]/addenda/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const input = await readJsonBody(request, 64 * 1024);
    const addendum = await addEncounterAddendum(encounterId, input, actor,{requestKey:readIdempotencyKey(request)});

    return createSuccessResponse(addendum, { status: 201 });
  });
}
