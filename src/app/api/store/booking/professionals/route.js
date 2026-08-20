import { getPublicProfessionals } from "@/services/public-booking-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET() {
  return executeApiHandler(async () => createSuccessResponse(await getPublicProfessionals()));
}
