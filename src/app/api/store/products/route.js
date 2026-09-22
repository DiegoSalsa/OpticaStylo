// Capa HTTP para store/products/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { getStoreProducts } from "@/services/store-catalog-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// GET /api/store/products/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return executeApiHandler(async () => {
    return createSuccessResponse(await getStoreProducts(new URL(request.url).searchParams));
  });
}
