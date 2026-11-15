import { authenticateCustomerRequest } from "@/auth/store-session";
import { downloadAccountPrescription, saveReviewedAccountPrescription } from "@/services/account-prescription-service";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    const image = await downloadAccountPrescription(account, (await params).prescriptionId);
    return new Response(new Uint8Array(image.data), { headers: {
      "Content-Type": image.mediaType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
    } });
  });
}

export async function PATCH(request, { params }) {
  return executeApiHandler(async () => createPrivateStoreResponse(await saveReviewedAccountPrescription(
    await authenticateCustomerRequest(request), (await params).prescriptionId, await readJsonBody(request),
  )));
}
