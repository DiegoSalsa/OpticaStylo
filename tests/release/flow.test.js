import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { createHash } from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { getSalesReportData } from "../../src/repositories/report-repository.js";
import { reservePublicRequestQuota } from "../../src/repositories/public-request-rate-limit-repository.js";
import { changeShipment, issueShipment, syncShipment } from "../../src/services/shipping-service.js";
import { shippingProvider } from "../../src/integrations/shipping/chilexpress.js";
import { auditDatabase, loadReference } from "../../scripts/lib/schema-audit.mjs";
import { inventoryDemo } from "../inventory/data.js";
import { fixtureRut } from "../rut-fixture.js";
import { buyer, image, prescription } from "../prescriptions/helpers.js";
import { actor, branch, employee, http, isolated, newCart, order, product, quote, stock, syntheticPayment, value } from "../shipping/helpers.js";

let admin;
before(async()=>{isolated();admin=await employee();});
beforeEach(async()=>{await prisma.public_request_rate_limits.deleteMany();});
after(async()=>{await prisma.$disconnect();});

test("32 solicitudes concurrentes comparten cuota sin perder incrementos ni fallar por serialización",async()=>{
  const quota={bucket:"release_atomic_quota",subjectHash:"a".repeat(64),windowSeconds:60};
  const counts=await Promise.all(Array.from({length:32},()=>reservePublicRequestQuota(quota)));
  assert.deepEqual(counts.map(r=>r.attempts).sort((a,b)=>a-b),Array.from({length:32},(_,i)=>i+1));
  assert.equal(new Set(counts.map(r=>r.expiresAt.toISOString())).size,1);
  await prisma.public_request_rate_limits.updateMany({where:{bucket:quota.bucket},data:{window_started_at:new Date(Date.now()-120000),expires_at:new Date(Date.now()-1000)}});
  const reset=await Promise.all(Array.from({length:8},()=>reservePublicRequestQuota(quota)));
  assert.deepEqual(reset.map(r=>r.attempts).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
});

test("Receta privada heredada → cuenta → despacho gratis → pago → OT → entrega → historial y outbox",async()=>{
  const clinicalBefore=await prisma.optical_prescriptions.count();
  const c=await newCart(await product(100001,[1,0,0]));
  // Reproduce el almacenamiento histórico permitido; no simula una carga Cloudinary.
  const hash=createHash("sha256").update(image).digest("hex");
  const recipe=await prisma.external_prescriptions.create({data:{cart_id:c.cart.id,source:"IMAGE",status:"DRAFT",file_data:image,file_sha256:hash,file_size_bytes:image.length,media_type:"image/png",original_filename:"fixture-sin-persona.png"}});
  await value(await http("/api/store/cart/prescription/confirm",{cookie:c.cookie,method:"PATCH",body:{...prescription,imageHash:hash}}));
  const customer={...buyer,rut:fixtureRut(9961),email:"release-integral@example.invalid",password:"Solo-release-sintetico-2026!"};
  const registered=await http("/api/store/accounts/register",{cookie:c.cookie,method:"POST",body:customer});await value(registered,201);
  const accountCookie=registered.headers.getSetCookie()[0].split(";")[0];c.cookie+=`; ${accountCookie}`;
  const q=(await value(await quote(c))).quotes[0];
  await value(await http("/api/store/cart",{cookie:c.cookie,method:"PATCH",body:{buyer:customer,fulfillment:{method:"DELIVERY",quoteId:q.id}}}));
  const checkout=await http("/api/store/cart/checkout",{cookie:c.cookie,method:"POST"});const sale=(await value(checkout,201)).order;
  assert.equal(sale.externalPrescription.id,recipe.id);assert.equal(sale.shippingFeeCents,0);assert.equal((await stock(c.productId)).reserved,1);
  assert.equal((await syntheticPayment(sale)).result.result,"APPROVED");
  await changeShipment(sale.id,actor,{action:"PREPARE",evidence:"Prueba integral con receta comercial"});
  await Promise.all([issueShipment(sale.id,actor),issueShipment(sale.id,actor)]);
  await changeShipment(sale.id,actor,{action:"HAND_OVER",evidence:"Recepción integral SINTÉTICA"});
  const sh=await prisma.shipping_shipments.findUniqueOrThrow({where:{sale_id:sale.id}});
  await syncShipment(sale.id,{...shippingProvider(),track:async()=>({ot:sh.ot,reference:sh.reference,description:"Entregado sintético",events:[{code:"14",description:"Entrega sintética integral",occurredAt:new Date().toISOString(),motive:null,location:null}]})});
  const orders=await value(await http("/api/store/orders",{cookie:accountCookie}));assert.equal(orders.find(o=>o.id===sale.id).status,"DELIVERED");
  const endpoint=`/api/store/orders/${sale.id}/prescription/file`, file=await http(endpoint,{cookie:accountCookie});
  assert.equal(file.status,200);assert.match(file.headers.get("cache-control"),/private, no-store/);assert.deepEqual(Buffer.from(await file.arrayBuffer()),image);
  assert.equal((await http(endpoint,{cookie:(await newCart(await product())).cookie})).status,404);
  assert.equal((await stock(c.productId)).on_hand,0);assert.equal((await stock(c.productId)).reserved,0);
  assert.equal(await prisma.inventory_movements.count({where:{sale_id:sale.id,kind:"SALE"}}),1);
  const outbox=await prisma.transactional_email_outbox.findMany({where:{sale_id:sale.id}});
  assert.ok(outbox.length>=3);assert.equal(new Set(outbox.map(o=>o.deduplication_key)).size,outbox.length);
  assert.ok(outbox.every(o=>o.status==="PENDING"&&!o.sent_at));assert.doesNotMatch(JSON.stringify(outbox.map(o=>o.payload)),/rightEye|file_data|file_sha256/);
  assert.equal(await prisma.optical_prescriptions.count(),clinicalBefore);
});

test("API real: sucursal ajena no consulta preferencias de pago y CSRF no modifica inventario",async()=>{
  const o=await order();await syntheticPayment(o.sale);const staff=await employee(inventoryDemo.staffEmail);
  await prisma.user_branches.delete({where:{user_id_branch_id:{user_id:inventoryDemo.staffId,branch_id:branch}}});
  try {
    const path=`/api/sales/${o.sale.id}/checkout/mercado-pago`;
    assert.equal((await http(path,{cookie:staff})).status,403);assert.equal((await http(path,{cookie:admin})).status,200);
    const before=await stock(o.productId);
    const forged=await fetch(`${process.env.EVALUATION_HTTP_URL}/api/inventory`,{method:"POST",headers:{cookie:admin,origin:"https://ajeno.invalid","Content-Type":"application/json"},body:JSON.stringify({productId:o.productId,branchId:branch,kind:"COUNT",quantity:999,reason:"Petición forjada"})});
    assert.equal(forged.status,403);assert.equal((await stock(o.productId)).on_hand,before.on_hand);
  } finally {await prisma.user_branches.create({data:{user_id:inventoryDemo.staffId,branch_id:branch}});}
});

test("Mantenimiento autenticado, acotado e idempotente sin proveedores externos",async()=>{
  const base=`${process.env.EVALUATION_HTTP_URL}/api/internal/operations`;
  assert.equal((await fetch(`${base}?job=reservations`)).status,401);
  const headers={authorization:`Bearer ${process.env.CRON_SECRET}`};
  for(let i=0;i<2;i++){
    const result=await value(await fetch(`${base}?job=reservations`,{headers}));assert.ok(result.processed<=5);
    const emails=await value(await fetch(`${base}?job=emails`,{headers}));assert.equal(emails.status,"DISABLED");
  }
  assert.equal((await fetch(`${base}?job=arbitrary`,{headers})).status,400);
});

test("Reporte de 12.000 ventas: agregados exactos, sucursal aislada, fecha Chile y resultado acotado",async()=>{
  const other=inventoryDemo.branches[1];
  await prisma.$executeRaw`INSERT INTO sales(status,origin,subtotal_cents,total_cents,branch_id,created_at) SELECT 'PENDING','IN_STORE',1000,1000,CASE WHEN n%2=0 THEN ${branch}::uuid ELSE ${other}::uuid END,'2035-06-01T04:00:00Z'::timestamptz + (n%28)*interval '1 day' FROM generate_series(1,12000) n`;
  const query={fromDate:new Date("2035-06-01T04:00:00Z"),toDate:new Date("2035-07-01T04:00:00Z"),allowedBranchIds:[branch],legacyActorId:actor.userId};
  const start=performance.now(),report=await getSalesReportData(query),elapsed=Math.round(performance.now()-start);
  assert.equal(report.summary.operationCount,6000);assert.equal(report.summary.totalCents,6000000);assert.equal(report.summary.paidCents,0);
  assert.ok(report.daily.every(d=>d.day.startsWith("2035-06-")));assert.ok(report.daily.length<=30);assert.ok(report.products.length<=20);assert.ok(JSON.stringify(report).length<6000);
  assert.equal((await getSalesReportData({...query,allowedBranchIds:[]})).summary.operationCount,0);
  const plan=await prisma.$queryRaw`EXPLAIN (ANALYZE,FORMAT JSON) SELECT count(*) FROM sales WHERE branch_id=${branch}::uuid AND status='PENDING' AND created_at>='2035-06-01'::timestamptz`;
  console.log(JSON.stringify({syntheticSales:12000,reportMs:elapsed,resultBytes:JSON.stringify(report).length,plan:plan[0]["QUERY PLAN"]}));
});

test("Auditoría final reconoce ocho migraciones sin drift y conserva el ledger histórico",async()=>{
  const audit=await auditDatabase(prisma,await loadReference());assert.equal(audit.status,"PRISMA_MANAGED",JSON.stringify(audit));assert.equal(audit.applied.length,8);assert.equal(audit.legacyCount,0);assert.deepEqual(audit.pending,[]);
});
