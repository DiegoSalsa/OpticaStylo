import { authenticateRequest } from "@/auth/authenticate-request";
import { createPrescription } from "@/services/prescription-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { encounterId } = await params;
    const input = await readJsonBody(request);
    const prescription = await createPrescription(encounterId, input, actor);

    return createSuccessResponse(prescription, { status: 201 });
  });
}
