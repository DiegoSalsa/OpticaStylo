import { authenticateRequest } from "@/auth/authenticate-request";
import {
  getOpenCashRegister,
  openCashRegister,
} from "@/services/cash-register-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getOpenCashRegister(actor));
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(
      await openCashRegister(await readJsonBody(request), actor),
      { status: 201 },
    );
  });
}
