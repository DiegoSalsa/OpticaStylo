import { authenticateRequest } from "@/auth/authenticate-request";
import { getInventoryTransfers, postInventoryTransfer } from "@/services/inventory-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { readIdempotencyKey } from "@/utils/idempotency-key";
export async function GET(request) { return executeApiHandler(async () => response(await getInventoryTransfers(new URL(request.url).searchParams, await authenticateRequest(request)))); }
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return response(await postInventoryTransfer(await readJsonBody(request), actor, readIdempotencyKey(request)));
  });
}
