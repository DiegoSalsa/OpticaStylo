import { authenticateRequest } from "@/auth/authenticate-request";
import { getPrescriptionList } from "@/services/prescription-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const prescriptions = await getPrescriptionList(
      new URL(request.url).searchParams,
      actor,
    );

    return createSuccessResponse(prescriptions);
  });
}
