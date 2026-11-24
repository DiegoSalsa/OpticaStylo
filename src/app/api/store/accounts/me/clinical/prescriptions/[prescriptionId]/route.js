import { authenticateCustomerRequest } from "@/auth/store-session";
import { findActiveAccountPrescription } from "@/repositories/customer-clinical-repository";
import { AppError } from "@/utils/app-error";
import { executeApiHandler } from "@/utils/error-handler";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { validateExternalPrescriptionId } from "@/validations/store-validation";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    const id = validateExternalPrescriptionId((await params).prescriptionId);
    const record = await findActiveAccountPrescription(account.id, id);
    if (!record) throw new AppError({ code: "CLINICAL_PRESCRIPTION_NOT_AVAILABLE", message: "La receta vigente no está disponible.", status: 404 });
    return createPrivateStoreResponse({ id: record.id, issuedAt: record.issuedAt, professional: record.professional });
  });
}
