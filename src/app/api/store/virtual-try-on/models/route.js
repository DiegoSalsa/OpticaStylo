// Capa HTTP para store/virtual-try-on/models/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { getPublic3dModels } from "@/services/virtual-try-on-3d-catalog-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
// GET /api/store/virtual-try-on/models/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(){return executeApiHandler(async()=>createSuccessResponse(await getPublic3dModels()))}
