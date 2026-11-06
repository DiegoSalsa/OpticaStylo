// Capa HTTP para customers/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import { createCustomer, getCustomerList } from "@/services/customer-service";
import { createPrivateStoreResponse as createSuccessResponse } from "@/utils/store-response";
import { executeClinicalHandler as executeApiHandler } from "@/utils/error-handler";
import {enforcePublicRequestRateLimit,PUBLIC_REQUEST_LIMIT_OPERATIONS} from "@/security/public-request-rate-limit";
import { readJsonBody } from "@/utils/http-request";

// GET /api/customers/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    await enforcePublicRequestRateLimit(request,PUBLIC_REQUEST_LIMIT_OPERATIONS.CUSTOMER_DIRECTORY,actor.userId);
    return createSuccessResponse(await getCustomerList(new URL(request.url).searchParams, actor));
  });
}

// POST /api/customers/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const customer = await createCustomer(await readJsonBody(request), actor);
    return createSuccessResponse(customer, { status: 201 });
  });
}
