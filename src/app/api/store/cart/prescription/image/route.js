import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { getPrescriptionImage, putPrescriptionImage } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readMultipartFormData } from "@/utils/http-request";
import { MAX_PRESCRIPTION_UPLOAD_BYTES } from "@/validations/store-validation";

export async function PUT(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const formData = await readMultipartFormData(request, MAX_PRESCRIPTION_UPLOAD_BYTES);
    return createSuccessResponse(await putPrescriptionImage(
      getStoreCartToken(request), account, formData.get("image"),
    ));
  });
}

export async function GET(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const image = await getPrescriptionImage(getStoreCartToken(request), account);
    return new Response(image.data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.filename)}`,
        "Content-Type": image.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
