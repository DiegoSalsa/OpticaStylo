import { getPublicVirtualTryOnFrames } from "@/services/virtual-try-on-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET() {
  return executeApiHandler(async () => {
    return createSuccessResponse(await getPublicVirtualTryOnFrames());
  });
}
