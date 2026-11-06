import { authenticateRequest } from "@/auth/authenticate-request";
import { renewInventoryReservation } from "@/services/inventory-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
export async function POST(request, { params }) {
  return executeApiHandler(async () => response(await renewInventoryReservation((await params).saleId, await authenticateRequest(request))));
}
