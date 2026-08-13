import { authenticateRequest } from "@/auth/authenticate-request";
import { getProfessionalOverrides } from "@/services/schedule-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const overrides = await getProfessionalOverrides(
      professionalId,
      new URL(request.url).searchParams,
      actor,
    );

    return createSuccessResponse(overrides);
  });
}
