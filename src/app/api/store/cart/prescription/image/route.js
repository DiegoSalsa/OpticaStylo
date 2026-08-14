import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { getPrescriptionImage, putPrescriptionImage } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { AppError } from "@/utils/app-error";
import { executeApiHandler } from "@/utils/error-handler";
import { MAX_PRESCRIPTION_IMAGE_BYTES } from "@/validations/store-validation";

export async function PUT(request) {
  return executeApiHandler(async () => {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PRESCRIPTION_IMAGE_BYTES + 1024 * 1024) {
      throw new AppError({
        code: "REQUEST_BODY_TOO_LARGE",
        message: "La carga supera el tamaño permitido.",
        status: 413,
      });
    }
    const account = await authenticateCustomerRequest(request, { optional: true });
    const formData = await request.formData();
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
