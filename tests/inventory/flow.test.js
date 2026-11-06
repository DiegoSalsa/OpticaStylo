import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { database, buyer } from "../prescriptions/helpers.js";
import { evaluation } from "../evaluation-data.js";
import { inventoryDemo } from "./data.js";
import { parseInventoryCsv, normalizeInventorySku } from "../../src/utils/inventory-import.js";
import { reconcileMercadoPagoPayment } from "../../src/repositories/payment-attempt-repository.js";
import { prisma } from "../../src/db/prisma.js";

const [a,b,c] = inventoryDemo.branches;
let db, admin, staff;
async function http(path, { cookie = admin, method = "GET", body, key = randomUUID() } = {}) {
  assert.match(process.env.EVALUATION_HTTP_URL, /^http:\/\/127\.0\.0\.1:3119$/);
  return fetch(`${process.env.EVALUATION_HTTP_URL}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json", "X-Idempotency-Key": key }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function value(response, status = 200) { const json = await response.json(); assert.equal(response.status, status, JSON.stringify(json)); assert.equal(json.success, true); return json.data; }
async function login(email) { const response = await http("/api/auth/login", { cookie: "", method: "POST", body: { email, password: evaluation.password } }); await value(response); return response.headers.getSetCookie()[0].split(";")[0]; }
async function move(productId, branchId, kind, quantity, expectedVersion = null, key) {
  return http("/api/inventory", { method: "POST", key, body: { productId, branchId, kind, quantity, expectedVersion, reason: "Operación sintética de integración" } });
}
async function product(counts = [3,7,0]) {
  const id = randomUUID(); await db.products.create({ data: { id, sku: `INV-${id}`.toUpperCase(), name: `Armazón sintético ${id}`, category: "FRAME", inventory_mode: "TRACKED", unit_price_cents: 1000, is_test_data: true, created_by: evaluation.adminId, updated_by: evaluation.adminId } });
  for (const [index, branchId] of [a,b,c].entries()) if (counts[index] != null) await value(await move(id, branchId, "COUNT", counts[index]));
  return id;
}
async function stock(id, branchId) { return db.inventory_stocks.findUnique({ where: { branch_id_product_id: { branch_id: branchId, product_id: id } } }); }
async function guest(items, branchId = a) {
  const response = await http("/api/store/cart", { cookie: "", method: "POST" }); await value(response, 201);
  const cookie = response.headers.getSetCookie()[0].split(";")[0];
  await value(await http("/api/store/cart/items", { cookie, method: "POST", body: { items: items.map(([productId, quantity]) => ({ productId, quantity })) } }));
  const configured = await http("/api/store/cart", { cookie, method: "PATCH", body: { buyer, fulfillment: { method: "PICKUP", branchId }, clinicalPrescriptionId: null } });
  return { cookie, configured };
}
async function order(id, quantity = 1, branchId = a) {
  const result = await guest([[id,quantity]], branchId); await value(result.configured);
  const sale = await value(await http("/api/store/cart/checkout", { cookie: result.cookie, method: "POST" }), 201);
  return { ...result, sale: sale.order };
}
before(async () => {
  db = database(); await db.public_request_rate_limits.deleteMany(); admin = await login(evaluation.adminEmail); staff = await login(inventoryDemo.staffEmail);
  for(const [index,branchId] of [a,b,c].entries()) {
    const terminal=await value(await http("/api/cash-register/terminals",{method:"POST",body:{branchId,name:`Regresión inventario ${index+1}`}}),201);
    await value(await http("/api/cash-register",{method:"POST",body:{branchId,terminalId:terminal.id,openingAmountCents:0}}),201);
  }
});
beforeEach(async () => { await db.public_request_rate_limits.deleteMany(); });
after(async () => { await db.$disconnect(); await prisma.$disconnect(); });

test("01 · SKU compartido con cantidades independientes y distinción entre cero y sin conteo", async () => {
  const id = await product([3,7,null]);
  assert.equal((await stock(id,a)).on_hand,3); assert.equal((await stock(id,b)).on_hand,7); assert.equal(await stock(id,c),null);
  const catalog = await value(await http(`/api/store/products/${id}`, { cookie: "" }));
  assert.equal(catalog.availability.source,"INVENTORY"); assert.equal(catalog.availability.branches.find((r) => r.id === c).state,"UNCOUNTED");
  await value(await move(id,c,"COUNT",0));
  const updated = await value(await http(`/api/store/products/${id}`, { cookie: "" }));
  assert.equal(updated.availability.branches.find((r) => r.id === c).state,"OUT_OF_STOCK");
});
test("02 · Entradas, ajustes, salidas e idempotencia conservan saldos e historial inmutable", async () => {
  const id = await product(), key = randomUUID();
  const responses = await Promise.all([move(id,a,"ENTRY",2,null,key), move(id,a,"ENTRY",2,null,key)]);
  for (const response of responses) await value(response);
  assert.equal((await stock(id,a)).on_hand,5);
  const old = await stock(id,a); await value(await move(id,a,"ADJUST",4,old.version));
  assert.equal((await move(id,a,"ADJUST",8,old.version)).status,409);
  assert.equal((await move(id,a,"EXIT",99)).status,409);
  assert.equal((await move(id,a,"ENTRY",-1)).status,400);
  const movements = await value(await http(`/api/inventory/movements?branchId=${a}&productId=${id}`));
  assert.equal(movements.length,3); assert.equal(movements[0].before,5); assert.equal(movements[0].after,4); assert.equal(movements[0].difference,-1); assert.equal(movements[0].actor,"Evaluación ADMIN");
  await assert.rejects(db.inventory_movements.update({ where: { id: movements[0].id }, data: { reason: "Cambiar historia" } }));
  await assert.rejects(db.inventory_stocks.update({ where: { branch_id_product_id: { branch_id: a, product_id: id } }, data: { on_hand: 20 } }));
  assert.equal((await stock(id,a)).on_hand,4);
});
test("03 · Venta POS reserva y descuenta solo su sucursal; pago repetido no duplica descuento", async () => {
  const id = await product([3,7,0]);
  const sale = await value(await http("/api/sales", { method: "POST", body: { operation: "SALE", branchId: a, items: [{ productId: id, quantity: 2 }] } }),201);
  assert.equal((await stock(id,a)).reserved,2); assert.equal((await stock(id,b)).reserved,0);
  await value(await http(`/api/sales/${sale.id}/confirm`, { method: "POST" }));
  const key = randomUUID(), payment = { amountCents: sale.totalCents, paymentMethod: "BANK_TRANSFER", reference: "PAGO-SINTETICO-SIN-COBRO-REAL" };
  await value(await http(`/api/sales/${sale.id}/payments`, { method: "POST", key, body: payment }),201);
  await value(await http(`/api/sales/${sale.id}/payments`, { method: "POST", key, body: payment }),201);
  assert.equal((await stock(id,a)).on_hand,1); assert.equal((await stock(id,a)).reserved,0); assert.equal((await stock(id,b)).on_hand,7);
  assert.equal(await db.inventory_movements.count({ where: { sale_id: sale.id, kind: "SALE" } }),1);
});
test("04 · Compra online asocia retiro a una sucursal y recupera la reserva persistida", async () => {
  const id = await product([3,7,0]), result = await order(id,2,b);
  assert.equal(result.sale.branch.id,b); assert.equal((await stock(id,b)).reserved,2); assert.equal((await stock(id,a)).reserved,0);
  const repeat = await value(await http("/api/store/cart/checkout", { cookie: result.cookie, method: "POST" }),201);
  assert.equal(repeat.order.id,result.sale.id); assert.equal((await stock(id,b)).reserved,2);
  const fetched = await value(await http(`/api/store/orders/${result.sale.id}`, { cookie: result.cookie }));
  assert.equal(fetched.branch.id,b); assert.equal(fetched.reservation[0].status,"HELD");
});
test("05 · Retiro bloqueado por insuficiencia, cantidad excesiva y productos sin configurar", async () => {
  const id = await product([1,0,0]), result = await guest([[id,1]],b);
  assert.equal(result.configured.status,409);
  assert.equal((await http("/api/store/cart/items", { cookie: result.cookie, method: "POST", body: { items: [{ productId:id,quantity:2 }] } })).status,409);
  assert.equal((await stock(id,a)).reserved,0);
});
test("06 · Dos compradores de la última unidad: exactamente un pedido y una reserva", async () => {
  const id = await product([1,0,0]), one = await guest([[id,1]]), two = await guest([[id,1]]);
  await value(one.configured); await value(two.configured);
  const responses = await Promise.all([one,two].map(({cookie}) => http("/api/store/cart/checkout", { cookie, method: "POST" })));
  assert.deepEqual(responses.map((r) => r.status).sort(),[201,409]);
  assert.equal((await stock(id,a)).reserved,1); assert.equal((await stock(id,a)).on_hand,1);
  assert.equal(await db.sale_items.count({ where: { product_id:id } }),1);
});
test("07 · Cancelación libera el compromiso una sola vez y no cambia existencias físicas", async () => {
  const id = await product(), result = await order(id,2);
  await value(await http(`/api/sales/${result.sale.id}/status`, { method: "PATCH", body: { status:"CANCELLED", cancellationReason:"Cancelación sintética" } }));
  assert.equal((await stock(id,a)).reserved,0); assert.equal((await stock(id,a)).on_hand,3);
  assert.equal((await http(`/api/sales/${result.sale.id}/status`, { method: "PATCH", body: { status:"CANCELLED", cancellationReason:"Reintento" } })).status,409);
  assert.equal(await db.inventory_movements.count({ where: { sale_id:result.sale.id,kind:"RELEASE" } }),1);
});
test("08 · Reservas sin pagos vencen, se liberan al consultar y pueden renovarse con validación", async () => {
  const id = await product(), result = await order(id,2);
  await db.inventory_reservations.updateMany({ where: { sale_id:result.sale.id }, data: { expires_at:new Date(Date.now()-60_000) } });
  await value(await http(`/api/store/products/${id}`,{cookie:""}));
  assert.equal((await stock(id,a)).reserved,0); assert.equal((await stock(id,a)).on_hand,3);
  assert.equal((await db.inventory_reservations.findFirst({where:{sale_id:result.sale.id}})).status,"EXPIRED");
  await value(await http(`/api/sales/${result.sale.id}/reservation`,{method:"POST"}));
  assert.equal((await stock(id,a)).reserved,2);
});
test("09 · Un empleado asignado no consulta ni modifica stock o ventas de otra sucursal", async () => {
  const id = await product();
  assert.equal((await http(`/api/inventory?branchId=${b}`,{cookie:staff})).status,403);
  assert.equal((await http("/api/inventory?consolidated=true",{cookie:staff})).status,403);
  assert.equal((await http("/api/inventory",{cookie:staff,method:"POST",body:{productId:id,branchId:b,kind:"ENTRY",quantity:1,reason:"Intento indebido"}})).status,403);
  assert.equal((await http("/api/sales",{cookie:staff,method:"POST",body:{operation:"SALE",branchId:b,items:[{productId:id,quantity:1}]}})).status,403);
  assert.equal((await stock(id,b)).on_hand,7);
  assert.equal((await http(`/api/inventory?branchId=${a}`,{cookie:""})).status,401);
});
test("10 · Transferencia descuenta origen, mantiene tránsito y solo ingresa al confirmar recepción", async () => {
  const id = await product([3,1,0]);
  const transfer = await value(await http("/api/inventory/transfers",{method:"POST",body:{branchId:a,destinationId:b,productId:id,quantity:2,reason:"Traslado sintético"}}));
  assert.equal((await stock(id,a)).on_hand,1); assert.equal((await stock(id,b)).on_hand,1);
  assert.equal((await http("/api/inventory/transfers",{cookie:staff,method:"POST",body:{id:transfer.id,action:"RECEIVE"}})).status,403);
  for(let i=0;i<2;i++) await value(await http("/api/inventory/transfers",{method:"POST",body:{id:transfer.id,action:"RECEIVE"}}));
  assert.equal((await stock(id,b)).on_hand,3);
  const returning = await value(await http("/api/inventory/transfers",{method:"POST",body:{branchId:b,destinationId:a,productId:id,quantity:1,reason:"Traslado a cancelar"}}));
  await value(await http("/api/inventory/transfers",{method:"POST",body:{id:returning.id,action:"CANCEL"}}));
  assert.equal((await stock(id,b)).on_hand,3); assert.equal((await stock(id,a)).on_hand,1);
});
test("11 · Varios productos deben coincidir físicamente en una única sucursal", async () => {
  const x = await product([1,0,0]), y = await product([0,1,0]), result = await guest([[x,1],[y,1]]);
  assert.equal(result.configured.status,409);
  const options = await value(await http("/api/store/cart/pickup",{cookie:result.cookie}));
  assert.equal(options.some((row)=>row.available),false); assert.equal((await stock(x,a)).reserved,0);
});
test("12 · Rechazo de pago libera stock y aprobación tardía requiere revisión sin sobreventa", async () => {
  const id = await product([1,0,0]), result = await order(id);
  const attempt = await db.payment_attempts.create({data:{sale_id:result.sale.id,provider:"MERCADO_PAGO",amount_cents:result.sale.totalCents,expires_at:new Date(Date.now()+30*60_000),external_preference_id:`TEST-${randomUUID()}`,status:"PENDING",checkout_url:"https://example.invalid/pago-sintetico"}});
  const payload = { externalReference:attempt.id,transactionAmount:result.sale.totalCents,currency:"CLP",liveMode:false,externalPreferenceId:attempt.external_preference_id,externalPaymentId:`SYNTHETIC-${randomUUID()}`,statusDetail:"synthetic",status:"rejected" };
  const notify = ()=>({eventType:"payment.updated",dataId:payload.externalPaymentId,payload:{synthetic:true},requestId:randomUUID()});
  await reconcileMercadoPagoPayment(notify(),payload,{expectedLiveMode:false});
  assert.equal((await stock(id,a)).reserved,0);
  const late = await reconcileMercadoPagoPayment(notify(),{...payload,status:"approved"},{expectedLiveMode:false});
  assert.equal(late.result,"REQUIRES_REVIEW"); assert.equal(await db.sale_payments.count({where:{sale_id:result.sale.id}}),0); assert.equal((await stock(id,a)).on_hand,1);
});
test("13 · Abono parcial conserva la reserva sin vencimiento y pago total descuenta una vez", async () => {
  const id = await product([3,1,0]);
  const sale = await value(await http("/api/sales",{method:"POST",body:{operation:"SALE",branchId:a,items:[{productId:id,quantity:1}]}}),201);
  await value(await http(`/api/sales/${sale.id}/payments`,{method:"POST",body:{amountCents:500,paymentMethod:"BANK_TRANSFER",reference:"ABONO-SINTETICO"}}),201);
  assert.equal((await db.inventory_reservations.findFirst({where:{sale_id:sale.id}})).expires_at,null);
  assert.equal((await stock(id,a)).on_hand,3); assert.equal((await stock(id,a)).reserved,1);
  await value(await http(`/api/sales/${sale.id}/payments`,{method:"POST",body:{amountCents:500,paymentMethod:"BANK_TRANSFER",reference:"SALDO-SINTETICO"}}),201);
  assert.equal((await stock(id,a)).on_hand,2); assert.equal((await stock(id,a)).reserved,0);
});
test("14 · Importación previsualiza identidades, detecta duplicados y exige confirmación/versiones", async () => {
  assert.equal(normalizeInventorySku(" MÁRCO-01 "),"MARCO01");
  assert.deepEqual(parseInventoryCsv('sku;cantidad\n"ABC-01";0')[0],{row:2,sku:"ABC-01",quantity:0});
  const id = await product([3,1,null]), p = await db.products.findUniqueOrThrow({where:{id}});
  const preview = await value(await http("/api/inventory/import",{method:"POST",body:{branchId:c,csv:`sku,cantidad\n${p.sku.toLowerCase()},4`}}));
  assert.equal(preview.rows[0].productId,id); assert.equal(preview.rows[0].current.onHand,null); assert.equal(await stock(id,c),null);
  assert.equal((await http("/api/inventory/import",{method:"POST",body:{action:"APPLY",branchId:c,rows:preview.rows,confirm:false,reason:"Prueba"}})).status,400);
  const key = randomUUID();
  for(let i=0;i<2;i++) assert.equal((await value(await http("/api/inventory/import",{method:"POST",key,body:{action:"APPLY",branchId:c,rows:preview.rows,confirm:true,reason:"Conteo sintético revisado"}}))).completed,true);
  assert.equal((await stock(id,c)).on_hand,4); assert.equal(await db.inventory_movements.count({where:{branch_id:c,product_id:id}}),1);
  const duplicate = await value(await http("/api/inventory/import",{method:"POST",body:{branchId:a,csv:`sku,cantidad\n${p.sku},2\n${p.sku},3\nDESCONOCIDO,1`}}));
  assert.ok(duplicate.rows[1].error); assert.ok(duplicate.rows[2].error);
});

test("15 · Pago web sintético mantiene unidades físicas hasta entregar; notificación repetida no duplica salida", async () => {
  const id = await product([1,0,0]), result = await order(id);
  const attempt = await db.payment_attempts.create({data:{sale_id:result.sale.id,provider:"MERCADO_PAGO",amount_cents:result.sale.totalCents,expires_at:new Date(Date.now()+30*60_000),external_preference_id:`TEST-${randomUUID()}`,status:"PENDING",checkout_url:"https://example.invalid/pago-sintetico"}});
  const payment = { externalReference:attempt.id,transactionAmount:result.sale.totalCents,currency:"CLP",liveMode:false,externalPreferenceId:attempt.external_preference_id,externalPaymentId:`SYNTHETIC-${randomUUID()}`,statusDetail:"synthetic",status:"approved" };
  const notify=()=>({eventType:"payment.updated",dataId:payment.externalPaymentId,payload:{synthetic:true},requestId:randomUUID()});
  await reconcileMercadoPagoPayment(notify(),payment,{expectedLiveMode:false});
  assert.equal((await stock(id,a)).on_hand,1); assert.equal((await stock(id,a)).reserved,1);
  assert.equal((await db.inventory_reservations.findFirst({where:{sale_id:result.sale.id}})).expires_at,null);
  for(const status of ["IN_PREPARATION","READY","DELIVERED"]) await value(await http(`/api/sales/${result.sale.id}/status`,{method:"PATCH",body:{status}}));
  await reconcileMercadoPagoPayment(notify(),payment,{expectedLiveMode:false});
  assert.equal((await stock(id,a)).on_hand,0); assert.equal((await stock(id,a)).reserved,0);
  assert.equal(await db.inventory_movements.count({where:{sale_id:result.sale.id,kind:"SALE"}}),1);
  assert.equal(await db.sale_payments.count({where:{sale_id:result.sale.id}}),1);
});
