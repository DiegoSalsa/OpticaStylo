import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { prisma } from "../../src/db/prisma.js";
import { shippingProvider } from "../../src/integrations/shipping/chilexpress.js";
import { changeShipment, issueShipment, syncShipment } from "../../src/services/shipping-service.js";
import { expireInventoryReservations } from "../../src/repositories/inventory-repository.js";
import { inventoryDemo } from "../inventory/data.js";
import { destination, origin } from "./data.js";
import { actor, branch, configure, employee, http, isolated, newCart, order, product, quote, stock, syntheticPayment, value } from "./helpers.js";

let admin, staff;
const shipment = (saleId) => prisma.shipping_shipments.findUniqueOrThrow({where:{sale_id:saleId}});
async function prepare(o) { await syntheticPayment(o.sale); return changeShipment(o.sale.id,actor,{action:"PREPARE",evidence:"Bulto físico sintético revisado"}); }
before(async()=>{ isolated(); admin=await employee(); staff=await employee(inventoryDemo.staffEmail); });
beforeEach(async()=>{ await prisma.public_request_rate_limits.deleteMany(); });
after(async()=>{await prisma.$disconnect();});

test("01 · Retiro conserva sucursal, reserva y costo cero sin crear despacho",async()=>{
  const o=await order({method:"PICKUP"});assert.equal(o.sale.fulfillment.method,"PICKUP");assert.equal(o.sale.branch.id,branch);assert.equal(o.sale.shippingFeeCents,0);
  assert.equal(await prisma.shipping_shipments.count({where:{sale_id:o.sale.id}}),0);assert.equal((await stock(o.productId)).reserved,1);
});
test("02 · Dirección validada, cotización trazable, costo y pedido se recuperan desde PostgreSQL",async()=>{
  const o=await order();const q=await prisma.shipping_quotes.findUniqueOrThrow({where:{id:o.q.id}});const s=await prisma.sales.findUniqueOrThrow({where:{id:o.sale.id}});
  assert.equal(Number(q.provider_cost),4990);assert.equal(Number(q.customer_charge),4990);assert.equal(Number(s.shipping_fee_cents),4990);assert.equal(s.shipping_quote_source,"SYNTHETIC");assert.equal(Number(s.total_cents),84980);
  assert.equal(q.snapshot.destination.countyCode,destination.countyCode);assert.equal(q.snapshot.destination.addressId,123456);assert.equal(q.snapshot.origin.countyCode,origin.countyCode);
  const read=await value(await http(`/api/store/orders/${o.sale.id}`,{cookie:o.cookie}));assert.equal(read.fulfillment.city,"Comuna sintética");assert.equal(read.branch.id,branch);
});
test("03 · Dirección incompleta y numeración inválida no generan cotización",async()=>{
  const c=await newCart(await product());for(const d of [{...destination,street:""},{...destination,number:"X"}])assert.equal((await quote(c,d)).status,400);
  assert.equal(await prisma.shipping_quotes.count({where:{cart_id:c.cart.id}}),0);
});
test("04 · Sin cobertura se diferencia de fallo temporal; ninguno habilita checkout",async()=>{
  const c=await newCart(await product());const no=await quote(c,{...destination,countyCode:"TEST-NONE"});assert.equal(no.status,422);assert.equal((await no.json()).error.code,"SHIPPING_NO_COVERAGE");
  const fail=await quote(c,{...destination,street:"ERROR TEMPORAL"});assert.equal(fail.status,503);assert.equal((await fail.json()).error.code,"SHIPPING_PROVIDER_UNAVAILABLE");
  assert.equal((await http("/api/store/cart/checkout",{cookie:c.cookie,method:"POST"})).status,409);
});
test("05 · Cotización expirada debe renovarse antes de configurar o confirmar",async()=>{
  const c=await newCart(await product());const q=(await value(await quote(c))).quotes[0];await value(await configure(c,q));await prisma.shipping_quotes.update({where:{id:q.id},data:{expires_at:new Date(Date.now()-1)}});
  assert.equal((await configure(c,q)).status,409);const r=await http("/api/store/cart/checkout",{cookie:c.cookie,method:"POST"});assert.equal(r.status,409);assert.equal((await r.json()).error.code,"SHIPPING_QUOTE_EXPIRED");
});
for(const [price,charge] of [[79990,4990],[100000,4990],[100001,0],[149990,0]])test(`06 · Total ${price}: cobro ${charge}, proveedor 4990 persistente`,async()=>{
  const o=await order({price});assert.equal(o.sale.shippingFeeCents,charge);assert.equal(o.sale.totalCents,price+charge);
  const q=await prisma.shipping_quotes.findUniqueOrThrow({where:{id:o.q.id}});assert.equal(Number(q.provider_cost),4990);assert.equal(Number(q.customer_charge),charge);
});
test("07 · Subtotal o descuento enviado desde el navegador no otorga beneficio",async()=>{
  const c=await newCart(await product(79990));const q=(await value(await quote(c))).quotes[0];
  const cfg=await http("/api/store/cart",{cookie:c.cookie,method:"PATCH",body:{buyer:(await import("../prescriptions/helpers.js")).buyer,subtotalCents:200000,discountCents:0,shippingFeeCents:0,fulfillment:{method:"DELIVERY",quoteId:q.id}}});
  assert.equal((await value(cfg)).shippingFeeCents,4990);
});
test("08 · Cambio de precio o carrito invalida la cotización",async()=>{
  const id=await product(),c=await newCart(id),q=(await value(await quote(c))).quotes[0];
  await prisma.products.update({where:{id},data:{unit_price_cents:149990}});assert.equal((await configure(c,q)).status,409);
  const next=(await value(await quote(c))).quotes[0];await value(await http("/api/store/cart/items",{cookie:c.cookie,method:"POST",body:{items:[{productId:id,quantity:2}]}}));assert.equal((await configure(c,next)).status,409);
});
test("09 · Falta de datos físicos y embalajes incompatibles bloquea cotizar",async()=>{
  const c=await newCart(await product(1000,undefined,null));assert.equal((await quote(c)).status,409);
  const second=await product(),id=await product();await prisma.products.update({where:{id:second},data:{shipping_logistics:{...(await prisma.products.findUnique({where:{id}})).shipping_logistics,packagingCode:"OTHER"}}});
  const mixed=await newCart(id,[{productId:second,quantity:1}]);assert.equal((await quote(mixed)).status,409);
});
test("10 · Origen independiente del retiro; sin inventario conjunto no hay despacho dividido",async()=>{
  const x=await product(1000,[1,0,0]),y=await product(1000,[0,1,0]);const c=await newCart(x,[{productId:y,quantity:1}]);
  await prisma.branches.update({where:{id:inventoryDemo.branches[1]},data:{shipping_enabled:true,shipping_origin:origin}});
  try { const r=await quote(c);assert.equal(r.status,409);assert.equal((await r.json()).error.code,"SHIPPING_SINGLE_ORIGIN_REQUIRED"); }
  finally {await prisma.branches.update({where:{id:inventoryDemo.branches[1]},data:{shipping_enabled:false}});}
});
test("11 · Stock consumido después de cotizar impide confirmar y reservar de más",async()=>{
  const id=await product(1000,[1,0,0]),c=await newCart(id),q=(await value(await quote(c))).quotes[0];await value(await configure(c,q));
  await order({id});const r=await http("/api/store/cart/checkout",{cookie:c.cookie,method:"POST"});assert.equal(r.status,409);assert.equal((await stock(id)).reserved,1);
});
test("12 · Reserva sin pago vence y se libera; pago tardío queda en revisión",async()=>{
  const o=await order({stocks:[1,0,0]});await prisma.inventory_reservations.updateMany({where:{sale_id:o.sale.id},data:{expires_at:new Date(Date.now()-1)}});await expireInventoryReservations();
  assert.equal((await stock(o.productId)).reserved,0);assert.equal((await syntheticPayment(o.sale)).result.result,"REQUIRES_REVIEW");assert.equal(await prisma.sale_payments.count({where:{sale_id:o.sale.id}}),0);
});
test("13 · Pago conciliado conserva reserva; preparación/OT no descuentan existencias",async()=>{
  const o=await order();await prepare(o);await expireInventoryReservations();assert.equal((await stock(o.productId)).reserved,1);
  assert.equal((await prisma.inventory_reservations.findFirst({where:{sale_id:o.sale.id}})).expires_at,null);await issueShipment(o.sale.id,actor);
  assert.equal((await stock(o.productId)).on_hand,5);assert.equal((await shipment(o.sale.id)).state,"OT_ISSUED");assert.equal((await prisma.sales.findUnique({where:{id:o.sale.id}})).status,"PAID");
});
test("14 · OT concurrente y doble clic emiten una sola solicitud externa",async()=>{
  const o=await order();await prepare(o);const real=shippingProvider();let calls=0;
  const provider={...real,issue:async(input)=>{calls++;await new Promise((r)=>setTimeout(r,100));return real.issue(input);}};
  await Promise.all([issueShipment(o.sale.id,actor,provider),issueShipment(o.sale.id,actor,provider)]);await issueShipment(o.sale.id,actor,provider);
  assert.equal(calls,1);assert.match((await shipment(o.sale.id)).ot,/^TEST-/);assert.equal(await prisma.shipping_operations.count({where:{shipment_id:(await shipment(o.sale.id)).id,operation:"OT_REQUESTED"}}),1);
});
test("15 · Timeout incierto concilia por referencia sin repetir POST",async()=>{
  const o=await order();await prepare(o);const real=shippingProvider();let calls=0;
  const provider={...real,issue:async()=>{calls++;throw Error("Timeout sintético después de emisión externa");}};
  await assert.rejects(issueShipment(o.sale.id,actor,provider));assert.equal((await shipment(o.sale.id)).state,"UNCERTAIN");await issueShipment(o.sale.id,actor,provider);
  assert.equal(calls,1);assert.equal((await shipment(o.sale.id)).state,"OT_ISSUED");
});
test("16 · Conciliación sin evidencia inequívoca mantiene bloqueo de reemisión",async()=>{
  const o=await order();await prepare(o);const real=shippingProvider();const provider={...real,issue:async()=>{throw Error("Timeout");},track:async()=>({ot:"OT-AJENA",reference:"OTRA"})};
  await assert.rejects(issueShipment(o.sale.id,actor,provider));await assert.rejects(issueShipment(o.sale.id,actor,provider),{code:"SHIPPING_RESULT_UNCERTAIN"});assert.equal((await shipment(o.sale.id)).state,"UNCERTAIN");
});
test("17 · Etiqueta privada claramente de prueba; cliente u otra sucursal no acceden",async()=>{
  const o=await order();await prepare(o);await issueShipment(o.sale.id,actor);
  const r=await http(`/api/sales/${o.sale.id}/shipment/label`,{cookie:admin});assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);assert.match(await r.text(),/NO VÁLIDA PARA TRANSPORTE/);
  assert.equal((await http(`/api/sales/${o.sale.id}/shipment/label`,{cookie:o.cookie})).status,401);
  await prisma.user_branches.delete({where:{user_id_branch_id:{user_id:inventoryDemo.staffId,branch_id:branch}}});
  try {assert.equal((await http(`/api/sales/${o.sale.id}/shipment/label`,{cookie:staff})).status,403);}
  finally {await prisma.user_branches.create({data:{user_id:inventoryDemo.staffId,branch_id:branch}});}
});
test("18 · Entrega al transportista compromete stock una sola vez; tracking no duplica",async()=>{
  const o=await order();await prepare(o);await issueShipment(o.sale.id,actor);
  for(let i=0;i<2;i++)await changeShipment(o.sale.id,actor,{action:"HAND_OVER",evidence:"Comprobante sintético de recepción N° 123"});
  assert.equal((await stock(o.productId)).on_hand,4);assert.equal((await stock(o.productId)).reserved,0);
  await syncShipment(o.sale.id);assert.equal((await stock(o.productId)).on_hand,4);assert.equal(await prisma.inventory_movements.count({where:{sale_id:o.sale.id,kind:"SALE"}}),1);
});
test("19 · Seguimiento persiste y deduplica eventos, limita consultas y conserva fallos",async()=>{
  const o=await order();await prepare(o);await issueShipment(o.sale.id,actor);const real=shippingProvider();let calls=0;
  const provider={...real,track:async(p)=>{calls++;const r=await real.track(p);return {...r,events:[...r.events,...r.events]};}};
  await syncShipment(o.sale.id,provider);await syncShipment(o.sale.id,provider);assert.equal(calls,1);
  const row=await shipment(o.sale.id);assert.equal(await prisma.shipping_tracking_events.count({where:{shipment_id:row.id}}),1);
  await prisma.shipping_shipments.update({where:{id:row.id},data:{next_sync_at:null}});await syncShipment(o.sale.id,provider);assert.equal(await prisma.shipping_tracking_events.count({where:{shipment_id:row.id}}),1);
  await prisma.shipping_shipments.update({where:{id:row.id},data:{next_sync_at:null}});await assert.rejects(syncShipment(o.sale.id,{...real,track:async()=>{throw Error("Offline");}}));
  const failed=await shipment(o.sale.id);assert.equal(failed.state,"IN_TRANSIT");assert.ok(failed.last_checked_at);assert.equal(failed.last_error_code,"SHIPPING_SYNC_FAILED");assert.ok(failed.next_sync_at>new Date());
});
test("20 · Incidencia/devolución no reincorpora mercancía ni reembolsa",async()=>{
  const o=await order();await prepare(o);await issueShipment(o.sale.id,actor);await changeShipment(o.sale.id,actor,{action:"HAND_OVER",evidence:"Comprobante sintético"});const row=await shipment(o.sale.id);
  const provider={...shippingProvider(),track:async()=>({ot:row.ot,reference:row.reference,description:"Devolución de prueba",events:[{code:"UNKNOWN",description:"Devolución sintética",motive:"Recepción física pendiente",occurredAt:"2026-11-06T16:00:00Z",location:null}]})};
  await syncShipment(o.sale.id,provider);assert.equal((await shipment(o.sale.id)).state,"EXCEPTION");assert.equal((await stock(o.productId)).on_hand,4);assert.equal(await prisma.sale_payments.count({where:{sale_id:o.sale.id}}),1);
});
test("21 · Entrega verificada por tracking finaliza comercio sin descontar dos veces",async()=>{
  const o=await order();await prepare(o);await issueShipment(o.sale.id,actor);const row=await shipment(o.sale.id);
  await syncShipment(o.sale.id,{...shippingProvider(),track:async()=>({ot:row.ot,reference:row.reference,description:"Entregado fixture",events:[{code:"14",description:"Entrega sintética",occurredAt:"2026-11-06T17:00:00Z",motive:null,location:null}]})});
  assert.equal((await shipment(o.sale.id)).state,"DELIVERED");assert.equal((await prisma.sales.findUnique({where:{id:o.sale.id}})).status,"DELIVERED");assert.equal((await stock(o.productId)).on_hand,4);
});
test("22 · Cancelación antes de OT libera reservas; OT emitida exige revisión",async()=>{
  const o=await order();await value(await http(`/api/sales/${o.sale.id}/status`,{cookie:admin,method:"PATCH",body:{status:"CANCELLED",cancellationReason:"Cancelación sintética previa"}}));
  assert.equal((await shipment(o.sale.id)).state,"CANCELLED");assert.equal((await stock(o.productId)).reserved,0);
  const issued=await order();await prepare(issued);await issueShipment(issued.sale.id,actor);const r=await http(`/api/sales/${issued.sale.id}/status`,{cookie:admin,method:"PATCH",body:{status:"CANCELLED",cancellationReason:"Revisión sintética"}});assert.equal(r.status,409);assert.equal((await r.json()).error.code,"SHIPMENT_CANCELLATION_REQUIRES_REVIEW");assert.equal((await stock(issued.productId)).reserved,1);
});
test("23 · Pedido impago no permite preparación/OT ni entrega comercial manual",async()=>{
  const o=await order();await assert.rejects(changeShipment(o.sale.id,actor,{action:"PREPARE",evidence:"Intento no autorizado"}),{code:"SHIPMENT_ORDER_INVALID"});
  await assert.rejects(issueShipment(o.sale.id,actor),{code:"SHIPMENT_NOT_PREPARED"});assert.equal((await shipment(o.sale.id)).ot,null);
  await prepare(o);for(const status of ["IN_PREPARATION","READY"])await value(await http(`/api/sales/${o.sale.id}/status`,{cookie:admin,method:"PATCH",body:{status}}));
  assert.equal((await http(`/api/sales/${o.sale.id}/status`,{cookie:admin,method:"PATCH",body:{status:"DELIVERED"}})).status,409);
});
test("24 · Datos privados y seguimiento de otro comprador están protegidos",async()=>{
  const own=await order(),other=await order();await prepare(own);await issueShipment(own.sale.id,actor);await syncShipment(own.sale.id);
  const read=await value(await http(`/api/store/orders/${own.sale.id}/shipment`,{cookie:own.cookie}));assert.equal(read.events.length,1);assert.equal(read.providerCost,undefined);assert.equal(read.destination,undefined);assert.equal(read.operations,undefined);
  assert.match((await http(`/api/store/orders/${own.sale.id}/shipment`,{cookie:own.cookie})).headers.get("cache-control"),/no-store/);
  assert.equal((await http(`/api/store/orders/${own.sale.id}/shipment`,{cookie:other.cookie})).status,404);
});
test("25 · Historial y outbox transaccional no duplican ni afirman envío de correo",async()=>{
  const o=await order();await prepare(o);await issueShipment(o.sale.id,actor);await issueShipment(o.sale.id,actor);
  const emails=await prisma.transactional_email_outbox.findMany({where:{sale_id:o.sale.id,template_code:"SHIPPING_UPDATE"}});assert.equal(emails.length,2);assert.ok(emails.every((e)=>e.status==="PENDING"&&!e.sent_at));assert.ok(emails.every((e)=>!JSON.stringify(e.payload).includes("rightEye")));
  const history=await value(await http(`/api/sales/${o.sale.id}/history`,{cookie:admin}));assert.ok(history.some((e)=>e.eventType==="CREATED"));
  const detail=await value(await http(`/api/sales/${o.sale.id}/shipment`,{cookie:admin}));assert.ok(detail.operations.some((e)=>e.operation==="OT_ISSUED"));
});
test("26 · Un origen de despacho sin retiro permite carrito y reserva sin habilitar retiro",async()=>{
  await prisma.branches.update({where:{id:branch},data:{pickup_enabled:false}});
  try {
    const o=await order();assert.equal(o.sale.fulfillment.method,"DELIVERY");assert.equal((await stock(o.productId)).reserved,1);
    const c=await newCart(await product());const pickups=await value(await http("/api/store/cart/pickup",{cookie:c.cookie}));assert.equal(pickups.some((b)=>b.id===branch),false);
  } finally {await prisma.branches.update({where:{id:branch},data:{pickup_enabled:true}});}
});
test("27 · Configuración logística exige administrador y nunca expone claves",async()=>{
  assert.equal((await http("/api/shipping/settings",{cookie:staff})).status,403);
  const settings=await value(await http("/api/shipping/settings",{cookie:admin}));assert.equal(settings.mode,"synthetic");assert.equal(settings.threshold,100000);assert.equal(typeof settings.credentials.orders,"boolean");
  const id=await product();assert.equal((await http("/api/shipping/settings",{cookie:admin,method:"POST",body:{kind:"PRODUCT",id,logistics:{validated:true,weightKg:-1}}})).status,409);
  await value(await http("/api/shipping/settings",{cookie:admin,method:"POST",body:{kind:"PRODUCT",id,logistics:{validated:true,weightKg:0.2,heightCm:2,widthCm:10,lengthCm:15,packagingCode:"TEST-BOX"}}}));
  const p=await prisma.products.findUnique({where:{id}});assert.equal(p.shipping_logistics.weightKg,0.2);assert.equal(p.shipping_logistics.validatedBy,actor.userId);
});
