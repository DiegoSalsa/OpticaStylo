import { authenticateRequest } from "@/auth/authenticate-request";
import { previewInventoryImport, applyInventoryImport } from "@/services/inventory-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { readIdempotencyKey } from "@/utils/idempotency-key";
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request), input = await readJsonBody(request, 400_000);
    return response(await (input.action === "APPLY" ? applyInventoryImport(input, actor, readIdempotencyKey(request)) : previewInventoryImport(input, actor)));
  });
}
