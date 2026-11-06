import { authenticateRequest } from "@/auth/authenticate-request";
import { shippingSettings, updateShippingSettings } from "@/services/shipping-settings-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function GET(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(await shippingSettings(await authenticateRequest(request))), { sensitive: true });
}
export async function POST(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(await updateShippingSettings(await authenticateRequest(request), await readJsonBody(request))), { sensitive: true });
}
