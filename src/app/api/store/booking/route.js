import { createPublicBooking } from "@/services/public-booking-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function POST(request) {
  return executeApiHandler(async () => createSuccessResponse(
    await createPublicBooking(await readJsonBody(request)),
    { status: 201 },
  ));
}
