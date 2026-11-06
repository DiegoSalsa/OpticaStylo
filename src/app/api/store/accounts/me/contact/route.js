import { authenticateCustomerRequest } from "@/auth/store-session";
import { contactState, saveContactEvent } from "@/services/customer-commercial-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeClinicalHandler as execute } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function GET(request) {
  return execute(async () => {
    const a = await authenticateCustomerRequest(request);
    return response(await contactState(a.customerId));
  });
}
export async function POST(request) {
  return execute(async () => {
    const a = await authenticateCustomerRequest(request);
    return response(await saveContactEvent(a.customerId, await readJsonBody(request), null, {
      account: a
    }), {
      status: 201
    });
  });
}
