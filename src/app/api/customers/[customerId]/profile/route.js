import { authenticateRequest } from "@/auth/authenticate-request";
import { commercialProfile } from "@/services/customer-commercial-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeClinicalHandler as execute } from "@/utils/error-handler";
export async function GET(request, {
  params
}) {
  return execute(async () => {
    const actor = await authenticateRequest(request),
      id = (await params).customerId;
    return response(await commercialProfile(id, actor));
  });
}
