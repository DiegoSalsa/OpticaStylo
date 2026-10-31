import { authenticateRequest } from "@/auth/authenticate-request";
import { getCashTerminals, createCashTerminal } from "@/services/cash-register-service";
import { createPrivateStoreResponse as response } from "@/utils/store-response";
import { executeApiHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
export async function GET(request) { return executeApiHandler(async()=>response(await getCashTerminals(new URL(request.url).searchParams.get("branchId"),await authenticateRequest(request)))); }
export async function POST(request) { return executeApiHandler(async()=>{ const actor=await authenticateRequest(request); return response(await createCashTerminal(await readJsonBody(request),actor),{status:201}); }); }
