import { authenticateRequest } from "@/auth/authenticate-request";
import { createPointOfSaleExternalPrescription } from "@/services/external-prescription-service";
import { createSuccessResponse } from "@/utils/api-response";
import { AppError } from "@/utils/app-error";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { MAX_PRESCRIPTION_IMAGE_BYTES } from "@/validations/store-validation";

function parseConfirmedData(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError({
      code: "INVALID_STORE_DATA",
      message: "Los datos confirmados de la receta no son válidos.",
      status: 400,
    });
  }
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const contentType = request.headers.get("content-type") ?? "";
    let input;
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const declaredLength = Number(request.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_PRESCRIPTION_IMAGE_BYTES + 1024 * 1024
      ) {
        throw new AppError({
          code: "REQUEST_BODY_TOO_LARGE",
          message: "La carga supera el tamaño permitido.",
          status: 413,
        });
      }
      const form = await request.formData();
      input = {
        confirmedData: parseConfirmedData(form.get("confirmedData")),
        customerId: form.get("customerId"),
        image: form.get("image"),
      };
    } else {
      input = await readJsonBody(request);
    }
    return createSuccessResponse(
      await createPointOfSaleExternalPrescription(input, actor),
      { status: 201 },
    );
  });
}
