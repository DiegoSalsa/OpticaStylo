import { authenticateRequest } from "@/auth/authenticate-request";
import { deleteProfessionalScheduleBlock } from "@/services/schedule-service";
import { executeApiHandler } from "@/utils/error-handler";

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
