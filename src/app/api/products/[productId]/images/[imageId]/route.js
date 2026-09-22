import { authenticateRequest } from "@/auth/authenticate-request";
import { removeProductImage } from "@/services/product-image-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// DELETE /api/products/[productId]/images/[imageId]/ - eliminar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function DELETE(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { imageId, productId } = await params;
    return createSuccessResponse(await removeProductImage(productId, imageId, actor));
  });
}
