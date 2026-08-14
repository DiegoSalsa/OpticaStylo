import { authenticateRequest } from "@/auth/authenticate-request";
import { createSale, getSaleList } from "@/services/sale-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getSaleList(new URL(request.url).searchParams, actor));
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const sale = await createSale(await readJsonBody(request), actor);
    return createSuccessResponse(sale, { status: 201 });
  });
}
