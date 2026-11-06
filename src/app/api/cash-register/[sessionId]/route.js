import { authenticateRequest } from "@/auth/authenticate-request";
import { getCashSession } from "@/services/cash-register-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
export async function GET(request,{params}) { return executeApiHandler(async()=>response(await getCashSession((await params).sessionId,await authenticateRequest(request)))); }
