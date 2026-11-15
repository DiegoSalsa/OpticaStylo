import { authenticateCustomerRequest } from "@/auth/store-session";
import { getAccountPrescriptions, uploadAccountPrescription } from "@/services/account-prescription-service";
import { executeApiHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { readMultipartFormData } from "@/utils/http-request";
import { MAX_PRESCRIPTION_UPLOAD_BYTES } from "@/validations/store-validation";
import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS } from "@/security/public-request-rate-limit";

export async function GET(request) {
  return executeApiHandler(async () => createPrivateStoreResponse(await getAccountPrescriptions(await authenticateCustomerRequest(request), new URL(request.url).searchParams.get("dependantId"))));
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_UPLOAD, account.id);
    const form = await readMultipartFormData(request, MAX_PRESCRIPTION_UPLOAD_BYTES);
    return createPrivateStoreResponse(await uploadAccountPrescription(account, form.get("image"), form.get("dependantId")), { status: 201 });
  });
}
