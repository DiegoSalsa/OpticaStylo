import { authenticateCustomerRequest } from "@/auth/store-session";
import { addAccountDependant, getAccountDependants } from "@/services/account-family-service";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function GET(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(await getAccountDependants(await authenticateCustomerRequest(request))));
}

export async function POST(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(await addAccountDependant(await authenticateCustomerRequest(request), await readJsonBody(request)), { status: 201 }));
}
