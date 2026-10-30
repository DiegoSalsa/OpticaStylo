import { authenticateCustomerRequest, getStoreOrderToken } from "@/auth/store-session";
import { getStoreOrderPrescription } from "@/services/store-service";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const { orderId } = await params;
    const account = await authenticateCustomerRequest(request, { optional: true });
    const file = await getStoreOrderPrescription(orderId, getStoreOrderToken(request, orderId), account, { file: true });
    return new Response(file.data, { headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": file.mediaType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "X-Content-Type-Options": "nosniff",
    } });
  });
}
