import { authenticateRequest } from "@/auth/authenticate-request";
import { createProduct, getProductList } from "@/services/product-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function GET(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    return createSuccessResponse(await getProductList(new URL(request.url).searchParams, actor));
  });
}

export async function POST(request) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const product = await createProduct(await readJsonBody(request), actor);
    return createSuccessResponse(product, { status: 201 });
  });
}
