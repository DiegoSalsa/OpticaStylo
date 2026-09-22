import { authenticateRequest } from "@/auth/authenticate-request";
import {
  createProfessionalScheduleBlock,
  getProfessionalScheduleBlocks,
} from "@/services/schedule-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/professionals/[professionalId]/schedule/blocks/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const blocks = await getProfessionalScheduleBlocks(
      professionalId,
      new URL(request.url).searchParams,
      actor,
    );

    return createSuccessResponse(blocks);
  });
}

// POST /api/professionals/[professionalId]/schedule/blocks/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const input = await readJsonBody(request);
    const block = await createProfessionalScheduleBlock(
      professionalId,
      input,
      actor,
    );

    return createSuccessResponse(block, { status: 201 });
  });
}
