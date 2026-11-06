import { authenticateRequest } from "@/auth/authenticate-request";
import { customerReport } from "@/services/customer-commercial-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeClinicalHandler as execute } from "@/utils/error-handler";
export async function GET(request) {
  return execute(async () => response(await customerReport(new URL(request.url).searchParams, await authenticateRequest(request))));
}
