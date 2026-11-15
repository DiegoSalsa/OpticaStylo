import { authenticateCustomerRequest } from "@/auth/store-session";
import { findActiveAccountPrescription } from "@/repositories/customer-clinical-repository";
import { AppError } from "@/utils/app-error";
import { createAccountPrescriptionPdf } from "@/utils/account-prescription-pdf";
import { executeClinicalHandler } from "@/utils/error-handler";
import { validateExternalPrescriptionId } from "@/validations/store-validation";

export async function GET(request, { params }) {
  return executeClinicalHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    const id = validateExternalPrescriptionId((await params).prescriptionId);
    const prescription = await findActiveAccountPrescription(account.id, id);
    if (!prescription) {
      throw new AppError({ code: "CLINICAL_PRESCRIPTION_NOT_AVAILABLE", message: "Esta receta vigente no está disponible.", status: 404 });
    }
    const pdf = await createAccountPrescriptionPdf(prescription, prescription.patient);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="receta-optica-stylo.pdf"',
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}
