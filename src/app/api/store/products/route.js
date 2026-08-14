import { getStoreProducts } from "@/services/store-catalog-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request) {
  return executeApiHandler(async () => {
    return createSuccessResponse(await getStoreProducts(new URL(request.url).searchParams));
  });
}
