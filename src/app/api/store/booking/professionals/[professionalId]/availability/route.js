import { getPublicAvailability } from "@/services/public-booking-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/booking/professionals/[professionalId]/availability/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const { professionalId } = await params;
    return createSuccessResponse(await getPublicAvailability(
      professionalId,
      new URL(request.url).searchParams,
    ));
  });
}
