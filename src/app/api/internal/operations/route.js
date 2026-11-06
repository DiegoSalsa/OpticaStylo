import { runOperationsJob } from "@/services/operations-service";
import { hasValidBearerSecret } from "@/utils/secret-authorization";
import { executeApiHandler } from "@/utils/error-handler";
export const maxDuration = 60;
export async function GET(request) {
  if(!hasValidBearerSecret(request,process.env.CRON_SECRET)) return Response.json({success:false},{status:401,headers:{"Cache-Control":"no-store"}});
  const response=await executeApiHandler(async()=>Response.json({success:true,data:await runOperationsJob(new URL(request.url).searchParams.get("job"))}),{sensitive:true});
  response.headers.set("Cache-Control","private, no-store");
  return response;
}
