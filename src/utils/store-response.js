import { createSuccessResponse } from "./api-response.js";

export function createPrivateStoreResponse(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return createSuccessResponse(data, { ...init, headers });
}
