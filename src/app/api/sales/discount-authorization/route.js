import { authenticateRequest } from "@/auth/authenticate-request";
import { grantDiscountAuthorization } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const authorization = await grantDiscountAuthorization(
      await readJsonBody(request),
      actor,
    );
    return createSuccessResponse(authorization, { status: 201 });
  });
}
