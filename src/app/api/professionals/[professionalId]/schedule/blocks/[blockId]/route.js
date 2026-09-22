import { authenticateRequest } from "@/auth/authenticate-request";
import { deleteProfessionalScheduleBlock } from "@/services/schedule-service";
import { executeApiHandler } from "@/utils/error-handler";

// DELETE /api/professionals/[professionalId]/schedule/blocks/[blockId]/ - eliminar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function DELETE(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { blockId, professionalId } = await params;

    await deleteProfessionalScheduleBlock(
      professionalId,
      blockId,
      actor,
    );
    return new Response(null, { status: 204 });
  });
}
