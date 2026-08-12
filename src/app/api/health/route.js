import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET() {
  return executeApiHandler(async () => {
    return createSuccessResponse({
      service: "optica-stylo",
      status: "ok",
    });
  });
}
