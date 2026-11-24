import { authenticateRequest } from "@/auth/authenticate-request";
import { getInventoryMovementProducts } from "@/services/inventory-service";
import { executeApiHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const query = new URL(request.url).searchParams;
    return createPrivateStoreResponse(await getInventoryMovementProducts(query, actor));
  });
}
