import { authenticateCustomerRequest } from "@/auth/store-session";
import { readAccountPrescription } from "@/services/account-prescription-service";
import { executeApiHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { enforcePublicRequestRateLimit, PUBLIC_REQUEST_LIMIT_OPERATIONS } from "@/security/public-request-rate-limit";

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    await enforcePublicRequestRateLimit(request, PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_EXTRACTION, account.id);
    return createPrivateStoreResponse(await readAccountPrescription(account, (await params).prescriptionId));
  });
}
