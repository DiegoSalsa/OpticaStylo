import { getPublic3dModelMetadata } from "@/services/virtual-try-on-3d-catalog-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
// GET /api/store/virtual-try-on/models/[assetId]/metadata/ - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(_request,{params}){return executeApiHandler(async()=>{const {assetId}=await params;const result=await getPublic3dModelMetadata(assetId);return createSuccessResponse(result,{headers:{"Cache-Control":"public, max-age=3600"}})})}
