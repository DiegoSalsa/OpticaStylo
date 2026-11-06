import assert from "node:assert/strict";
import { test } from "node:test";
import { shippingCharge, shippingConfiguration } from "../../src/config/shipping.js";
import { createChilexpress } from "../../src/integrations/shipping/chilexpress.js";
import { packItems, trackingState, validateDestination } from "../../src/services/shipping-policy.js";
import { decodeShippingLabel } from "../../src/services/shipping-service.js";
import { renderTransactionalEmail } from "../../src/integrations/email/transactional-email-template.js";
import { logistics, packaging, destination } from "./data.js";

test("Política estricta: bajo, exactamente y sobre $100.000; costo proveedor separado", () => {
  assert.equal(shippingCharge(79990,0,4990),4990); assert.equal(shippingCharge(100000,0,4990),4990);
  assert.equal(shippingCharge(100001,0,4990),0); assert.equal(shippingCharge(149990,0,4990),0);
  assert.equal(shippingCharge(50000,0,4990,49999),0);
});
test("Descuentos cambian elegibilidad sin incluir el costo del despacho", () => {
  assert.equal(shippingCharge(100001,1,4990),4990); assert.equal(shippingCharge(149990,49989,4990),0);
  assert.equal(shippingCharge(99000,0,4990),4990); assert.throws(() => shippingCharge(10,11,1));
});
test("Dirección incompleta, numeración inválida y texto inyectado se rechazan", () => {
  assert.deepEqual(validateDestination(destination),destination);
  for (const value of [{...destination,number:"A"},{...destination,street:""},{...destination,countyCode:null},{...destination,street:"<script>"}]) assert.throws(() => validateDestination(value));
});
test("Embalaje exige mediciones validadas, compatibilidad, capacidad y cabida conjunta", () => {
  const items = [{ product: { shipping_logistics: logistics }, quantity: 1 }];
  assert.equal(packItems(items,packaging).weight,"0.15");
  assert.throws(() => packItems([{product:{shipping_logistics:{...logistics,validated:false}},quantity:1}],packaging));
  assert.throws(() => packItems([{product:{shipping_logistics:{...logistics,validated:"false"}},quantity:1}],packaging));
  assert.throws(() => packItems(items,{...packaging,max_units:0}));
  assert.throws(() => packItems(items,{...packaging,code:"OTHER"}));
  assert.throws(() => packItems(items,{...packaging,height_cm:1}));
});
test("Simulador bloqueado fuera del PostgreSQL local aislado; producción requiere validación", () => {
  assert.equal(shippingConfiguration({}).mode,"disabled");
  assert.throws(() => shippingConfiguration({CHILEXPRESS_MODE:"synthetic",CHILEXPRESS_SYNTHETIC_ALLOWED:"true",NODE_ENV:"production",DATABASE_URL:"postgresql://x@production/db"}));
  assert.throws(() => shippingConfiguration({CHILEXPRESS_MODE:"production"}));
  const local = { CHILEXPRESS_MODE:"synthetic", CHILEXPRESS_SYNTHETIC_ALLOWED:"true", DEPLOYMENT_ENVIRONMENT:"university", EMAIL_MODE:"disabled", STORE_E2E_SCHEMA:"stylo_e2e_0000000000000000", DATABASE_URL:"postgresql://stylo_test@127.0.0.1:55461/opticastylo_evaluation?schema=stylo_e2e_0000000000000000" };
  assert.equal(shippingConfiguration(local).synthetic,true);
  assert.throws(() => shippingConfiguration({...local,DATABASE_URL:local.DATABASE_URL.replace("opticastylo_evaluation","real_store")}));
  assert.throws(() => shippingConfiguration({...local,EMAIL_MODE:"live"}));
  assert.throws(() => shippingConfiguration({SHIPPING_FREE_THRESHOLD_CLP:"NaN"}));
});
test("Adaptador real usa contrato oficial v1.0 y clave por servicio sin red en esta prueba", async () => {
  const requests=[];
  const config={mode:"test",host:"https://testservices.wschilexpress.com",keys:{coverage:"TEST-ONLY",rating:"TEST-ONLY",orders:"TEST-ONLY"}};
  const provider=createChilexpress({config,fetcher:async (url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url.includes("courier")?{statusCode:0,data:{courierServiceOptions:[{serviceTypeCode:3,serviceDescription:"Servicio fixture",serviceValue:"1234",conditions:"Prueba"}]}}:{statusCode:0,regions:[{regionId:"TEST",regionName:"Fixture"}]}),{status:200});}});
  await provider.regions();const rates=await provider.rates({originCountyCode:"TEST",destinationCountyCode:"TEST",package:{weight:"1",height:"1",width:"1",length:"1"},productType:3,contentType:5,declaredWorth:"10",deliveryTime:0});
  assert.match(requests[0].url,/georeference\/api\/v1.0\/regions$/);assert.match(requests[1].url,/rating\/api\/v1.0\/rates\/courier$/);
  assert.equal(requests[1].options.headers["Ocp-Apim-Subscription-Key"],"TEST-ONLY");assert.equal(rates[0].providerCost,1234);assert.equal(rates[0].estimatedDelivery,undefined);
});
test("Fallos del proveedor no se convierten en direcciones válidas ni tarifas", async()=>{
  const config={mode:"test",host:"https://testservices.wschilexpress.com",keys:{coverage:"TEST"}};
  await assert.rejects(createChilexpress({config,fetcher:async()=>{throw Error("network");}}).address(destination),{code:"SHIPPING_PROVIDER_UNAVAILABLE"});
  await assert.rejects(createChilexpress({config,fetcher:async()=>new Response(JSON.stringify({statusCode:-1}),{status:400})}).address(destination),{code:"SHIPPING_ADDRESS_INVALID"});
});
test("Contratos oficiales de OT, reimpresión y tracking se normalizan sin datos privados", async()=>{
  const calls=[];
  const config={mode:"test",host:"https://testservices.wschilexpress.com",keys:{orders:"TEST-ONLY"},ordersEnabled:true,tcc:"1",rut:"12345678",sellerRut:"12345678"};
  const provider=createChilexpress({config,fetcher:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return new Response(JSON.stringify({statusCode:0,data:url.endsWith("/tracking")?{transportOrderData:{transportOrderNumber:"12345678901",reference:"TEST-REFERENCE",status:"Fixture"},deliveryData:{receptorRut:"PRIVATE"},trackingEvents:[{description:"Fixture",eventDateTime:"2026-11-01T12:00:00Z",code:{eventCode:"11"},certificadoEntrega:"PRIVATE"}]}:{header:{certificateNumber:123},detail:[{transportOrderNumber:12345678901,statusCode:0,label:{labelData:"VEVTVA=="}}]}}),{status:200});
  }});
  const issued=await provider.issue({header:{},details:[]});assert.equal(issued.ot,"12345678901");
  assert.equal(await provider.label(issued.ot),"VEVTVA==");const tracked=await provider.track({ot:issued.ot,reference:"TEST-REFERENCE"});
  assert.equal(tracked.events[0].code,"11");assert.doesNotMatch(JSON.stringify(tracked),/PRIVATE/);
  assert.match(calls[0].url,/transport-orders\/api\/v1.0\/transport-orders$/);assert.equal(calls[1].body.labelType,2);assert.equal(calls[2].body.showTrackingEvents,1);assert.equal(calls[2].body.rut,12345678);
});
test("Etiqueta acepta formatos reconocidos y bloquea HTML/SVG del proveedor",()=>{
  assert.equal(decodeShippingLabel(Buffer.from("%PDF-1.4 fixture").toString("base64")).mime,"application/pdf");
  assert.throws(()=>decodeShippingLabel(Buffer.from("<svg onload='alert(1)'>").toString("base64")));
});
test("Tracking no infiere entrega desde etiquetas ni códigos desconocidos",()=>{
  assert.equal(trackingState([]),null);assert.equal(trackingState([{code:"14",occurredAt:"2026-11-01T12:00:00Z"}]),"DELIVERED");
  assert.equal(trackingState([{code:"UNKNOWN",occurredAt:"2026-11-01T12:00:00Z"}]),"EXCEPTION");
});
test("Correo logístico usa mínimos datos y marca los eventos sintéticos",()=>{
  const email=renderTransactionalEmail({templateCode:"SHIPPING_UPDATE",payload:{stage:"OT_ISSUED",ot:"TEST-OT",synthetic:true,clinical:"SECRET"}},{mode:"simulate"});
  assert.match(email.text,/SINTÉTICO/);assert.doesNotMatch(email.text,/SECRET/);
});
