import {authenticateRequest} from "@/auth/authenticate-request";
import {getEncounter} from "@/services/clinical-service";
import {getPrescriptionList} from "@/services/prescription-service";
import {renderClinicalRecordHtml} from "@/utils/clinical-print";
import {executeClinicalHandler} from "@/utils/error-handler";
export async function GET(request,{params}){return executeClinicalHandler(async()=>{
  const actor=await authenticateRequest(request),query=new URL(request.url).searchParams;
  const record=await getEncounter((await params).encounterId,actor,{patientId:query.get("patientId"),revision:query.get("revision"),accessType:"PRINTED"});
  const prescriptions=record.isHistoricalVersion?[]:(await getPrescriptionList(new URLSearchParams({patientId:record.patient.id}),actor)).filter((r)=>r.encounterId===record.id);
  return new Response(renderClinicalRecordHtml(record,prescriptions),{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","X-Robots-Tag":"noindex, noarchive","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'"}});
});}
