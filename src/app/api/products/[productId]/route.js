import { authenticateRequest } from "@/auth/authenticate-request";
import { getProduct, updateProduct } from "@/services/product-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    return createSuccessResponse(await getProduct(productId, actor));
  });
}

export async function PATCH(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { productId } = await params;
    const product = await updateProduct(productId, await readJsonBody(request), actor);
    return createSuccessResponse(product);
  });
}
