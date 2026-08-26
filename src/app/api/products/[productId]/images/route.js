import { authenticateRequest } from "@/auth/authenticate-request";
import { addProductImage, getProductImages } from "@/services/product-image-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readMultipartFormData } from "@/utils/http-request";
import { MAX_PRODUCT_IMAGE_UPLOAD_BYTES } from "@/validations/product-image-validation";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    return createSuccessResponse(await getProductImages(productId, actor));
  });
}

export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    const form = await readMultipartFormData(request, MAX_PRODUCT_IMAGE_UPLOAD_BYTES);
    return createSuccessResponse(await addProductImage(productId, {
      alt: form.get("alt"),
      file: form.get("image"),
    }, actor), { status: 201 });
  });
}
