import { authenticateRequest } from "@/auth/authenticate-request";
import { changeShipment, getShipment } from "@/services/shipping-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function GET(request, { params }) {
  return executeApiHandler(async () => createPrivateStoreResponse(await getShipment((await params).saleId, await authenticateRequest(request))));
}
export async function POST(request, { params }) {
  return executeApiHandler(async () => createPrivateStoreResponse(await changeShipment((await params).saleId, await authenticateRequest(request), await readJsonBody(request))));
}
