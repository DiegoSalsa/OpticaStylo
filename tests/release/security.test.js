import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { assertRequestOrigin } from "../../src/security/request-origin.js";
import { readJsonBody, readMultipartFormData } from "../../src/utils/http-request.js";
import { handleApiError } from "../../src/utils/error-handler.js";
import { validateSalesReportQuery } from "../../src/validations/report-validation.js";

test("CSRF: rechaza origen ajeno y null, permite mismo origen y webhook sin cookies de navegador", () => {
  for (const headers of [{origin:"https://ajeno.invalid"},{origin:"null"},{"sec-fetch-site":"cross-site"}]) {
    assert.throws(()=>assertRequestOrigin(new Request("https://stylo.invalid/api/sales",{method:"POST",headers})),{code:"REQUEST_ORIGIN_REJECTED"});
  }
  for (const headers of [{origin:"https://stylo.invalid"},{}]) assert.doesNotThrow(()=>assertRequestOrigin(new Request("https://stylo.invalid/api/sales",{method:"POST",headers})));
  assert.doesNotThrow(()=>assertRequestOrigin(new Request("http://localhost:3139/api/sales",{method:"POST",headers:{origin:"http://127.0.0.1:3139",host:"127.0.0.1:3139"}})));
  assert.throws(()=>assertRequestOrigin(new Request("http://localhost:3139/api/sales",{method:"POST",headers:{origin:"http://localhost:3139",host:"127.0.0.1:3139"}})),{code:"REQUEST_ORIGIN_REJECTED"});
});

test("Cuerpo sin Content-Length: cancela el stream al superar el límite", async () => {
  let cancelled=false, reads=0;
  const body=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(1024));},cancel(){cancelled=true;}});
  await assert.rejects(readJsonBody(new Request("https://stylo.invalid/api",{method:"POST",body,duplex:"half"}),2048),{code:"REQUEST_BODY_TOO_LARGE"});
  assert.equal(cancelled,true);assert.ok(reads<=5);
});

test("JSON y multipart válidos conservan sus datos dentro del límite", async () => {
  assert.deepEqual(await readJsonBody(new Request("https://stylo.invalid/api",{method:"POST",body:'{"safe":true}'})),{safe:true});
  const form=new FormData();form.set("image",new Blob(["fixture"]),"synthetic.txt");
  const parsed=await readMultipartFormData(new Request("https://stylo.invalid/api",{method:"PUT",body:form}),4096);
  assert.equal(await parsed.get("image").text(),"fixture");
  await assert.rejects(readJsonBody(new Request("https://stylo.invalid/api",{method:"POST",body:"invalid"})),{code:"INVALID_JSON"});
});

test("Errores imprevistos: ni respuesta ni log contienen consulta, secreto o ficha", async () => {
  const logs=[], previous=console.error;
  console.error=(...args)=>logs.push(args);
  let response;
  try {response=handleApiError(Object.assign(new Error("postgresql://private:secret@host patient@example.invalid"),{code:"P2025",meta:{clinical:"sensitive"}}),{sensitive:true});}
  finally {console.error=previous;}
  assert.equal(response.status,500);
  assert.doesNotMatch(JSON.stringify(logs)+await response.text(),/secret|patient@|clinical|postgresql/);
  assert.match(JSON.stringify(logs),/P2025/);
});

test("Reporte usa días de Chile incluso en cambio horario y limita rango", () => {
  const winter=validateSalesReportQuery(new URLSearchParams("from=2026-06-01&to=2026-06-01"));
  assert.equal(winter.fromDate.toISOString(),"2026-06-01T04:00:00.000Z");
  assert.equal(winter.toDate.toISOString(),"2026-06-02T04:00:00.000Z");
  const transition=validateSalesReportQuery(new URLSearchParams("from=2026-09-06&to=2026-09-06"));
  assert.equal(transition.fromDate.toISOString(),"2026-09-06T04:00:00.000Z");
  assert.equal((transition.toDate-transition.fromDate)/3600000,23);
  const recent=validateSalesReportQuery(new URLSearchParams(),new Date("2026-06-02T01:00:00Z"));assert.equal(recent.to,"2026-06-01");
  assert.throws(()=>validateSalesReportQuery(new URLSearchParams("from=2020-01-01&to=2026-01-01")),{code:"INVALID_REPORT_QUERY"});
});

test("Staging: configuración sintética aislada, sin afirmar validación remota y bloqueo de secretos",()=>{
  const env={...process.env,DEPLOYMENT_ENVIRONMENT:"staging",VERCEL_ENV:"preview",STAGING_ACCESS_RESTRICTION_CONFIRMED:"true",STAGING_DATABASE_ISOLATED:"true",DATABASE_URL:"postgresql://synthetic@127.0.0.1/staging?schema=stylo_staging_1234567890abcdef",APP_PUBLIC_URL:"https://staging.example.invalid",EMAIL_MODE:"disabled",CHILEXPRESS_MODE:"disabled",OPENAI_PRESCRIPTION_READER_ENABLED:"false",MERCADO_PAGO_PRODUCTION_ENABLED:"false",CHILEXPRESS_ORDERS_ENABLED:"false",OPERATIONS_ENABLED:"false"};
  for(const key of Object.keys(env))if(/^(MERCADO_PAGO|CHILEXPRESS|CLOUDINARY|RESEND|OPENAI)_.*(TOKEN|KEY|SECRET|TCC)$/.test(key))delete env[key];
  const run=extra=>spawnSync(process.execPath,["scripts/staging-preflight.mjs"],{env:{...env,...extra},encoding:"utf8",windowsHide:true});
  const safe=run({});assert.equal(safe.status,0,safe.stderr);assert.equal(JSON.parse(safe.stdout).remoteValidated,false);assert.equal(JSON.parse(safe.stdout).deploy,false);
  assert.equal(run({CLOUDINARY_API_SECRET:"synthetic-negative-test"}).status,1);
  assert.equal(run({STAGING_ACCESS_RESTRICTION_CONFIRMED:"false"}).status,1);
  assert.equal(run({DATABASE_URL:"postgresql://synthetic@127.0.0.1/main?schema=public"}).status,1);
});
