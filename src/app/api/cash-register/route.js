// Capa HTTP para cash-register/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getOpenCashRegister,
  openCashRegister,
} from "@/services/cash-register-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/cash-register/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getOpenCashRegister(actor));
  });
}

// POST /api/cash-register/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(
      await openCashRegister(await readJsonBody(request), actor),
      { status: 201 },
    );
  });
}
