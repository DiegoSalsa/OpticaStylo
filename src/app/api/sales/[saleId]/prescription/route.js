import { authenticateRequest } from "@/auth/authenticate-request";
import { getOrderPrescription } from "@/services/prescription-service";
import { executeClinicalHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function GET(request, { params }) {
  return executeClinicalHandler(async () => {
    const actor = await authenticateRequest(request);
    const { saleId } = await params;
    return createPrivateStoreResponse(await getOrderPrescription(saleId, actor));
  });
}
