import { authenticateRequest } from "@/auth/authenticate-request";
import { getCustomer, updateCustomer } from "@/services/customer-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { customerId } = await params;
    return createSuccessResponse(await getCustomer(customerId, actor));
  });
}

export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { customerId } = await params;
    const customer = await updateCustomer(customerId, await readJsonBody(request), actor);
    return createSuccessResponse(customer);
  });
}
