import { authenticateRequest } from "@/auth/authenticate-request";
import { getSalesReport } from "@/services/report-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () =>
    createSuccessResponse(
      await getSalesReport(
        new URL(request.url).searchParams,
        await authenticateRequest(request),
      ),
    ),
  );
}
