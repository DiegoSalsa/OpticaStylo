import { authenticateRequest } from "@/auth/authenticate-request";
import { customerConflicts } from "@/services/customer-commercial-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeClinicalHandler as execute } from "@/utils/error-handler";
export async function GET(request) {
  return execute(async () => response(await customerConflicts(new URL(request.url).searchParams, await authenticateRequest(request))));
}
