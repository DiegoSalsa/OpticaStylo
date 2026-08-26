import {
  authenticateCustomerRequest,
  createStoreCartCookie,
  getStoreCartToken,
} from "@/auth/store-session";
import {
  createStoreCart,
  getStoreCart,
  updateStoreCart,
} from "@/services/store-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import {
  enforcePublicRequestRateLimit,
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";

export async function POST(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    await enforcePublicRequestRateLimit(
      request,
      PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_CART_CREATION,
      account?.id ?? null,
    );
    const result = await createStoreCart(account);
    const response = createSuccessResponse(result.cart, { status: 201 });
    response.headers.set("Set-Cookie", createStoreCartCookie(result.token, result.maxAgeSeconds));
    return response;
  });
}

export async function GET(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createSuccessResponse(await getStoreCart(getStoreCartToken(request), account));
  });
}

export async function PATCH(request) {
  return executeApiHandler(async () => {
    const account = await authenticateCustomerRequest(request, { optional: true });
    return createSuccessResponse(await updateStoreCart(
      getStoreCartToken(request),
      account,
      await readJsonBody(request),
    ));
  });
}
