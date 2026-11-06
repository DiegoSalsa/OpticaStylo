import { authenticateRequest } from "@/auth/authenticate-request";
import { getInventoryMovements } from "@/services/inventory-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
export async function GET(request) { return executeApiHandler(async () => response(await getInventoryMovements(new URL(request.url).searchParams, await authenticateRequest(request)))); }
