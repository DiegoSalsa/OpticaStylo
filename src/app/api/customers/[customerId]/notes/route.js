import { authenticateRequest } from "@/auth/authenticate-request";
import { commercialNotes, addCommercialNote } from "@/services/customer-commercial-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeClinicalHandler as execute } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function GET(request, {
  params
}) {
  return execute(async () => {
    const actor = await authenticateRequest(request),
      id = (await params).customerId;
    return response(await commercialNotes(id, new URL(request.url).searchParams, actor));
  });
}
export async function POST(request, {
  params
}) {
  return execute(async () => response(await addCommercialNote((await params).customerId, await readJsonBody(request), await authenticateRequest(request)), {
    status: 201
  }));
}
