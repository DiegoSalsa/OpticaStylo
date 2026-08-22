import { authenticateRequest } from "@/auth/authenticate-request";
import {
  createExternalPrescription,
  createPointOfSaleExternalPrescription,
  getExternalPrescriptionList,
} from "@/services/external-prescription-service";
import { createSuccessResponse } from "@/utils/api-response";
import { AppError } from "@/utils/app-error";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody, readMultipartFormData } from "@/utils/http-request";
import { MAX_PRESCRIPTION_UPLOAD_BYTES } from "@/validations/store-validation";

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
      const form = await readMultipartFormData(request, MAX_PRESCRIPTION_UPLOAD_BYTES);
      if (form.has("file")) {
        input = {
          customerId: form.get("customerId"),
          file: form.get("file"),
          notes: form.get("notes"),
          patientId: form.get("patientId"),
          source: "IMAGE",
        };
      } else {
        input = {
          confirmedData: parseConfirmedData(form.get("confirmedData")),
          customerId: form.get("customerId"),
          image: form.get("image"),
          patientId: form.get("patientId"),
        };
      }
    } else {
      input = await readJsonBody(request);
    }
    return createSuccessResponse(
      await (input.source
        ? createExternalPrescription(input, actor)
        : createPointOfSaleExternalPrescription(input, actor)),
      { status: 201 },
    );
  });
}

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getExternalPrescriptionList(
      new URL(request.url).searchParams,
      actor,
    ));
  });
}
