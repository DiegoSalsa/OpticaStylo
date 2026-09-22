import { getStoreProduct } from "@/services/store-catalog-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/products/[productId]/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(_request, { params }) {
  return executeApiHandler(async () => {
    const { productId } = await params;
    return createSuccessResponse(await getStoreProduct(productId));
  });
}
