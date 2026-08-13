import { authenticateRequest } from "@/auth/authenticate-request";
import { getProfessionalAvailability } from "@/services/schedule-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { professionalId } = await params;
    const availability = await getProfessionalAvailability(
      professionalId,
      new URL(request.url).searchParams,
      actor,
    );

    return createSuccessResponse(availability);
  });
}
