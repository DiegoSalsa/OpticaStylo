import {authenticateRequest} from "@/auth/authenticate-request";
import {clinicalPatients} from "@/services/clinical-care-service";
import {createPrivateStoreResponse as response} from "@/utils/store-response";
import {executeClinicalHandler} from "@/utils/error-handler";
export async function GET(request){return executeClinicalHandler(async()=>response(await clinicalPatients(new URL(request.url).searchParams,await authenticateRequest(request))));}
