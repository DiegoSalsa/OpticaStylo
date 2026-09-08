import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { getHealthStatus } from "@/services/health-service";

export async function GET() {
  return executeApiHandler(async () => {
    return createSuccessResponse(await getHealthStatus());
  });
}
