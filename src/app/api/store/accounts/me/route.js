// Capa HTTP para store/accounts/me/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { authenticateCustomerRequest } from "@/auth/store-session";
import { getStoreAccountProfile, updateStoreAccountContact } from "@/services/store-account-service";
import { createPrivateStoreResponse } from "@/utils/store-response";
import { executeClinicalHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";

// GET /api/store/accounts/me/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeClinicalHandler(async () => {
    return createPrivateStoreResponse(
      getStoreAccountProfile(await authenticateCustomerRequest(request)),
    );
  });
}

export async function PATCH(request) {
  return executeClinicalHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    const updated = await updateStoreAccountContact(account, await readJsonBody(request));
    return createPrivateStoreResponse(updated);
  });
}