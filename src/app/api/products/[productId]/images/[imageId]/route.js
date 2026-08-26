import { authenticateRequest } from "@/auth/authenticate-request";
import { removeProductImage } from "@/services/product-image-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function DELETE(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { imageId, productId } = await params;
    return createSuccessResponse(await removeProductImage(productId, imageId, actor));
  });
}
