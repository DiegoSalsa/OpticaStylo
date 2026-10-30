import { authenticateRequest } from "@/auth/authenticate-request";
import { getInventoryBranches, configureInventoryBranch } from "@/services/inventory-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function GET(request) { return executeApiHandler(async () => response(await getInventoryBranches(await authenticateRequest(request), new URL(request.url).searchParams.get("destinations") === "true"))); }
export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return response(await configureInventoryBranch(await readJsonBody(request), actor));
  });
}
