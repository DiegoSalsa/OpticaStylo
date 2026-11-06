import {authenticateRequest} from "@/auth/authenticate-request";
import {getCareAssignments,assignCare} from "@/services/clinical-care-service";
import {createPrivateStoreResponse as response} from "@/utils/store-response";
import {executeClinicalHandler} from "@/utils/error-handler";
import {readJsonBody} from "@/utils/http-request";
export async function GET(request){return executeClinicalHandler(async()=>response(await getCareAssignments(new URL(request.url).searchParams,await authenticateRequest(request))));}
export async function POST(request){return executeClinicalHandler(async()=>{const actor=await authenticateRequest(request);return response(await assignCare(await readJsonBody(request),actor),{status:201});});}
