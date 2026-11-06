import { authenticateRequest } from "@/auth/authenticate-request";
import { saveContactEvent } from "@/services/customer-commercial-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeClinicalHandler as execute } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function POST(request, {
  params
}) {
  return execute(async () => response(await saveContactEvent((await params).customerId, await readJsonBody(request), await authenticateRequest(request)), {
    status: 201
  }));
}
