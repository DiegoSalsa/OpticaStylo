import { authenticateRequest } from "@/auth/authenticate-request";
import { createCustomer, getCustomerList } from "@/services/customer-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getCustomerList(new URL(request.url).searchParams, actor));
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const customer = await createCustomer(await readJsonBody(request), actor);
    return createSuccessResponse(customer, { status: 201 });
  });
}
