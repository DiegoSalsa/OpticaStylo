// Capa HTTP para store/booking/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { createPublicBooking } from "@/services/public-booking-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";

// POST /api/store/booking/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const input = await readJsonBody(request);
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.PUBLIC_BOOKING,
      input?.patient?.rut ?? input?.patient?.email,
    );
    return createSuccessResponse(await createPublicBooking(input), { status: 201 });
  });
}
