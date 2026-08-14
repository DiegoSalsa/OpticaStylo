import { authenticateCustomerRequest, getStoreCartToken } from "@/auth/store-session";
import { deleteStoreCartItem, putStoreCartItem } from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

export async function PUT(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const { productId } = await params;
    return createSuccessResponse(await putStoreCartItem(
      getStoreCartToken(request), account, productId, await readJsonBody(request),
    ));
  });
}

export async function DELETE(request, { params }) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    const { productId } = await params;
    return createSuccessResponse(await deleteStoreCartItem(
      getStoreCartToken(request), account, productId,
    ));
  });
}
