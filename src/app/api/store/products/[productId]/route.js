import { getStoreProduct } from "@/services/store-catalog-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(_request, { params }) {
  return executeApiHandler(async () => {
    const { productId } = await params;
    return createSuccessResponse(await getStoreProduct(productId));
  });
}
