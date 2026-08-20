import { getPublic3dModels } from "@/services/virtual-try-on-3d-catalog-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";
export async function GET(){return executeApiHandler(async()=>createSuccessResponse(await getPublic3dModels()))}
