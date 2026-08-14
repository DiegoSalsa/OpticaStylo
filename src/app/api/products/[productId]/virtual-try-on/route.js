import { authenticateRequest } from "@/auth/authenticate-request";
import {
  deactivateVirtualTryOnAsset,
  getVirtualTryOnAssetHistory,
  uploadVirtualTryOnAsset,
} from "@/services/virtual-try-on-service";
import { createSuccessResponse } from "@/utils/api-response";
import { AppError } from "@/utils/app-error";
import { executeApiHandler } from "@/utils/error-handler";
import { MAX_VIRTUAL_TRY_ON_IMAGE_BYTES } from "@/validations/virtual-try-on-validation";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    return createSuccessResponse(await getVirtualTryOnAssetHistory(productId, actor));
  });
}

export async function PUT(request, { params }) {
  return executeApiHandler(async () => {
    const declaredLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength)
      && declaredLength > MAX_VIRTUAL_TRY_ON_IMAGE_BYTES + 1024 * 1024
    ) {
      throw new AppError({
        code: "REQUEST_BODY_TOO_LARGE",
        message: "La carga supera el tamaño permitido.",
        status: 413,
      });
    }
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    const asset = await uploadVirtualTryOnAsset(
      productId,
      await request.formData(),
      actor,
    );
    return createSuccessResponse(asset, { status: 201 });
  });
}

export async function DELETE(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    return createSuccessResponse(await deactivateVirtualTryOnAsset(productId, actor));
  });
}
