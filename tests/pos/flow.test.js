import assert from "node:assert/strict";
import {before,beforeEach,afterEach,after,test} from "node:test";
import {randomUUID} from "node:crypto";
import {database} from "../prescriptions/helpers.js";
import {evaluation} from "../evaluation-data.js";
import {inventoryDemo} from "../inventory/data.js";
const [a,b]=inventoryDemo.branches;let db,admin,staff,toClose=[];
async function http(path,{body,cookie=admin,method="GET",key=randomUUID()}={}){assert.match(process.env.EVALUATION_HTTP_URL,/^http:\/\/127\.0\.0\.1:3119$/);return fetch(`${process.env.EVALUATION_HTTP_URL}${path}`,{method,headers:{cookie,"Content-Type":"application/json","X-Idempotency-Key":key},...(body?{body:JSON.stringify(body)}:{})});}
async function value(response,status=200){const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));assert.equal(result.success,true);return result.data;}
async function login(email){const r=await http("/api/auth/login",{cookie:"",method:"POST",body:{email,password:evaluation.password}});await value(r);return r.headers.getSetCookie()[0].split(";")[0];}
async function terminal(branchId=a){return value(await http("/api/cash-register/terminals",{method:"POST",body:{branchId,name:`Caja prueba ${randomUUID()}`}}),201);}
async function open({branchId=a,openingAmountCents=100,cookie=admin,terminalId}={}){const t=terminalId??(await terminal(branchId)).id;const s=await value(await http("/api/cash-register",{method:"POST",cookie,body:{branchId,terminalId:t,openingAmountCents}}),201);toClose.push(s.id);return s;}
async function product(){const id=randomUUID();await db.products.create({data:{id,sku:`POS-${id}`.toUpperCase(),name:`Marco POS sintético ${id}`,category:"FRAME",inventory_mode:"TRACKED",unit_price_cents:1000,is_test_data:true,created_by:evaluation.adminId,updated_by:evaluation.adminId}});for(const branchId of [a,b])await value(await http("/api/inventory",{method:"POST",body:{branchId,productId:id,kind:"COUNT",quantity:10,expectedVersion:null,reason:"Conteo de prueba POS"}}));return id;}
async function sale(productId,session,extra={}){return value(await http("/api/sales",{method:"POST",body:{operation:"SALE",branchId:session.branchId,cashSessionId:session.id,items:[{productId,quantity:1}],...extra}}),201);}
async function pay(s,session,payments=[{paymentMethod:"CASH",amountCents:1000,cashReceivedCents:2000}],key=randomUUID(),cookie=admin){return http(`/api/sales/${s.id}/payments`,{method:"POST",cookie,key,body:{cashSessionId:session.id,payments}});}
async function stock(id,branchId=a){return db.inventory_stocks.findUniqueOrThrow({where:{branch_id_product_id:{branch_id:branchId,product_id:id}}});}
async function movement(s,type,amount,reason="Movimiento sintético",key=randomUUID(),cookie=admin){return http(`/api/cash-register/${s.id}/movements`,{method:"POST",cookie,key,body:{movementType:type,amountCents:amount,reason}});}
before(async()=>{db=database();await db.public_request_rate_limits.deleteMany();admin=await login(evaluation.adminEmail);staff=await login(inventoryDemo.staffEmail);});
beforeEach(async()=>{toClose=[];await db.public_request_rate_limits.deleteMany();});
afterEach(async()=>{for(const id of toClose){const row=await db.cash_register_sessions.findUnique({where:{id}});if(row?.status==="OPEN"){const s=await value(await http(`/api/cash-register/${id}`));await value(await http(`/api/cash-register/${id}/close`,{method:"POST",body:{closingCountedCents:s.expectedAmountCents,closingNotes:"Fin del caso sintético; pendientes identificados"}}));}}});
after(async()=>{await db.$disconnect();});

test("01 · Apertura concurrente rechaza duplicado y admite otra caja en la misma sucursal",async()=>{
  const t=await terminal(),body={branchId:a,terminalId:t.id,openingAmountCents:100};
  const responses=await Promise.all([http("/api/cash-register",{method:"POST",body}),http("/api/cash-register",{method:"POST",body})]);
  assert.deepEqual(responses.map((r)=>r.status).sort(),[201,409]);const s=await value(responses.find((r)=>r.status===201),201);toClose.push(s.id);
  assert.equal(await db.cash_register_sessions.count({where:{terminal_id:t.id,status:"OPEN"}}),1);
  const second=await open();assert.notEqual(second.terminal.id,t.id);assert.equal(s.branchId,a);assert.equal(s.openedBy.id,evaluation.adminId);
});
test("02 · Venta en efectivo descuenta solo el local y la caja conserva el neto, separado del vuelto",async()=>{
  const session=await open(),id=await product(),s=await sale(id,session),paid=await value(await pay(s,session),201);
  assert.equal(paid.status,"PAID");assert.equal(paid.payments[0].changeCents,1000);assert.equal((await stock(id)).on_hand,9);assert.equal((await stock(id,b)).on_hand,10);
  const cash=await value(await http(`/api/cash-register/${session.id}`));assert.equal(cash.expectedAmountCents,1100);assert.equal(cash.cashPaymentsCents,1000);assert.equal(cash.movements.filter((m)=>m.paymentId).length,1);
});
test("03 · Cobro electrónico exige referencia y no aumenta el efectivo físico",async()=>{
  const session=await open(),s=await sale(await product(),session);
  assert.equal((await pay(s,session,[{paymentMethod:"TRANSBANK",amountCents:1000}])).status,400);
  await value(await pay(s,session,[{paymentMethod:"TRANSBANK",amountCents:1000,reference:"TERMINAL-EXTERNO-SINTETICO"}]),201);
  const cash=await value(await http(`/api/cash-register/${session.id}`));assert.equal(cash.expectedAmountCents,100);assert.equal(cash.electronicPaymentsCents,1000);assert.equal(cash.cashPaymentsCents,0);
});
test("04 · Pago dividido se acredita atómicamente, respeta saldo y registra cada medio una vez",async()=>{
  const session=await open(),id=await product(),s=await sale(id,session),parts=[{paymentMethod:"CASH",amountCents:600,cashReceivedCents:1000},{paymentMethod:"GETNET",amountCents:400,reference:"FOLIO-PRUEBA"}];
  const paid=await value(await pay(s,session,parts),201);assert.equal(paid.paymentMethod,"MIXED");assert.equal(paid.payments.length,2);assert.equal(paid.balanceCents,0);assert.equal((await stock(id)).on_hand,9);
  const cash=await value(await http(`/api/cash-register/${session.id}`));assert.equal(cash.expectedAmountCents,700);assert.equal(cash.receivedCents,1000);assert.equal(cash.byMethod.GETNET,400);
  const other=await sale(await product(),session);assert.equal((await pay(other,session,[{paymentMethod:"CASH",amountCents:800,cashReceivedCents:800},{paymentMethod:"GETNET",amountCents:400,reference:"F"}])).status,409);assert.equal(await db.sale_payments.count({where:{sale_id:other.id}}),0);
});
test("05 · Ingresos, egresos, retiros y reversos son persistentes, autorizados e idempotentes",async()=>{
  const session=await open(),key=randomUUID();for(let i=0;i<2;i++)await value(await movement(session,"MANUAL_IN",100,"Ingreso sintético",key));
  await value(await movement(session,"MANUAL_OUT",20));const withdrawn=await value(await movement(session,"WITHDRAWAL",50));assert.equal(withdrawn.expectedAmountCents,130);
  const original=withdrawn.movements.find((m)=>m.movementType==="WITHDRAWAL");
  const reversed=await value(await http(`/api/cash-register/${session.id}/movements`,{method:"POST",body:{movementType:"REVERSAL",reversalOf:original.id,reason:"Corrección sintética autorizada"}}));assert.equal(reversed.expectedAmountCents,180);
  assert.equal((await movement(session,"MANUAL_OUT",999)).status,409);assert.equal((await movement(session,"MANUAL_IN",99,"Otro importe",key)).status,409);
  await assert.rejects(db.cash_register_movements.update({where:{id:original.id},data:{amount_cents:1}}));await assert.rejects(db.cash_register_movements.delete({where:{id:original.id}}));
});
test("06 · Cierre cuadrado guarda resumen y bloquea nuevos cobros, movimientos y cambios históricos",async()=>{
  const session=await open(),s=await sale(await product(),session);await value(await pay(s,session),201);
  const body={closingCountedCents:1100,closingNotes:null};const closed=await value(await http(`/api/cash-register/${session.id}/close`,{method:"POST",body}));assert.equal(closed.differenceCents,0);assert.equal(closed.cashPaymentsCents,1000);
  await value(await http(`/api/cash-register/${session.id}/close`,{method:"POST",body}));assert.equal((await movement(session,"MANUAL_IN",1)).status,409);
  await assert.rejects(db.cash_register_sessions.update({where:{id:session.id},data:{closing_counted_cents:2}}));await assert.rejects(db.sale_payments.update({where:{id:closed.payments[0].id},data:{amount_cents:2}}));
  const pending=await value(await http("/api/sales",{method:"POST",body:{operation:"SALE",branchId:a,items:[{productId:await product(),quantity:1}]}}),201);assert.equal((await pay(pending,session)).status,409);
});
test("07 · Descuadre exige observación y el cierre original no acepta importes retroactivos",async()=>{
  const session=await open();assert.equal((await http(`/api/cash-register/${session.id}/close`,{method:"POST",body:{closingCountedCents:90}})).status,400);
  const close=await value(await http(`/api/cash-register/${session.id}/close`,{method:"POST",body:{closingCountedCents:90,closingNotes:"Faltante sintético de diez pesos"}}));assert.equal(close.differenceCents,-10);
  assert.equal((await http(`/api/cash-register/${session.id}/close`,{method:"POST",body:{closingCountedCents:100,closingNotes:"Alteración"}})).status,409);
  const persisted=await value(await http(`/api/cash-register/${session.id}`));assert.equal(persisted.closingCountedCents,90);assert.equal(persisted.expectedAmountCents,100);
});
test("08 · Saldos pendientes se identifican al cerrar y un cobro posterior pertenece a la nueva sesión",async()=>{
  const session=await open(),s=await sale(await product(),session);await value(await pay(s,session,[{paymentMethod:"BANK_TRANSFER",amountCents:400,reference:"ABONO-SINTETICO"}]),201);
  assert.equal((await http(`/api/cash-register/${session.id}/close`,{method:"POST",body:{closingCountedCents:100}})).status,400);
  const closed=await value(await http(`/api/cash-register/${session.id}/close`,{method:"POST",body:{closingCountedCents:100,closingNotes:"Saldo pendiente entregado al próximo turno"}}));assert.equal(closed.pending[0].balanceCents,600);
  const next=await open();await value(await pay(s,next,[{paymentMethod:"CASH",amountCents:600,cashReceivedCents:1000}]),201);
  const snapshot=await value(await http(`/api/cash-register/${session.id}`));assert.equal(snapshot.receivedCents,400);assert.equal(snapshot.pending[0].balanceCents,600);assert.equal((await value(await http(`/api/cash-register/${next.id}`))).cashPaymentsCents,600);
});
test("09 · Empleado solo opera su caja asignada y no consulta ventas o comprobantes de otra sucursal",async()=>{
  const other=await open({branchId:b}),s=await sale(await product(),other);await value(await pay(s,other),201);
  assert.equal((await http(`/api/cash-register/${other.id}`,{cookie:staff})).status,403);assert.equal((await http(`/api/cash-register/terminals?branchId=${b}`,{cookie:staff})).status,403);
  assert.equal((await http(`/api/sales/${s.id}`,{cookie:staff})).status,403);assert.equal((await http(`/api/sales/${s.id}/receipt`,{cookie:staff,method:"POST",body:{}})).status,403);
  assert.equal((await http(`/api/cash-register?history=true&consolidated=true`,{cookie:staff})).status,403);
  const own=await open({cookie:staff});await value(await movement(own,"MANUAL_IN",10,"Ingreso propio",randomUUID(),staff));assert.equal((await http(`/api/cash-register/${(await open()).id}`,{cookie:staff})).status,403);
  const listed=await value(await http("/api/sales?pageSize=100",{cookie:staff}));assert.ok(!listed.items.some((sale)=>sale.id===s.id));
  const localCatalog=await value(await http(`/api/products/${s.items[0].productId}`,{cookie:staff}));assert.equal(localCatalog.availability.branches.length,1);assert.equal(localCatalog.availability.branches[0].id,a);
  const staffReport=await value(await http("/api/reports/sales?origin=IN_STORE",{cookie:staff})),adminReport=await value(await http("/api/reports/sales?origin=IN_STORE"));assert.ok(adminReport.summary.paidCents-staffReport.summary.paidCents>=1000);
  const ownLedger=await value(await http(`/api/cash-register/${own.id}`,{cookie:staff}));const manual=ownLedger.movements.find((m)=>m.movementType==="MANUAL_IN");assert.equal((await http(`/api/cash-register/${own.id}/movements`,{method:"POST",cookie:staff,body:{movementType:"REVERSAL",reversalOf:manual.id,reason:"Reverso sin permiso"}})).status,403);
});
test("10 · Cliente comercial conserva historial y el mismo RUT normalizado no se duplica",async()=>{
  const customer=await db.customers.findUniqueOrThrow({where:{id:evaluation.customerId}});
  assert.equal((await http("/api/customers",{method:"POST",body:{firstNames:"Duplicado sintético",rut:customer.rut.replaceAll(".","").toLowerCase()}})).status,409);
  const created=await value(await http("/api/customers",{method:"POST",body:{firstNames:"Comprador sintético",email:`pos-${randomUUID()}@example.invalid`,phone:"+56912345678"}}),201);assert.equal(created.patientId,null);
  const session=await open(),s=await sale(await product(),session,{customerId:created.id});await value(await pay(s,session),201);
  const history=await value(await http(`/api/sales?customerId=${created.id}`));assert.equal(history.items[0].id,s.id);
  const receipt=await value(await http(`/api/sales/${s.id}/receipt`,{method:"POST",body:{}}),201);assert.equal(receipt.payload.branch.id,a);assert.equal(receipt.payload.seller.id,evaluation.adminId);
  await assert.rejects(db.sale_receipts.update({where:{id:receipt.id},data:{payload:{totalCents:1}}}));await assert.rejects(db.sale_receipts.delete({where:{id:receipt.id}}));
  const html=await http(`/api/sales/${s.id}/receipt/print?receiptId=${receipt.id}`);assert.equal(html.status,200);assert.match(await html.text(),/No constituye boleta tributaria/);
});
test("11 · Cotización valida precio vigente y se convierte una vez conservando número, cliente e historial",async()=>{
  const session=await open(),id=await product(),quote=await sale(id,session,{operation:"QUOTATION",customerId:evaluation.customerId});assert.equal((await stock(id)).reserved,0);
  await db.products.update({where:{id},data:{unit_price_cents:1200}});assert.equal((await http(`/api/sales/${quote.id}/confirm`,{method:"POST"})).status,409);
  const updated=await value(await http(`/api/sales/${quote.id}`,{method:"PATCH",body:{branchId:a,customerId:evaluation.customerId,items:[{productId:id,quantity:1}]}}));assert.equal(updated.totalCents,1200);
  const responses=await Promise.all([http(`/api/sales/${quote.id}/confirm`,{method:"POST"}),http(`/api/sales/${quote.id}/confirm`,{method:"POST"})]);for(const r of responses)assert.equal((await value(r)).id,quote.id);
  assert.equal((await stock(id)).reserved,1);assert.equal(await db.sale_events.count({where:{sale_id:quote.id,event_type:"STATUS_CHANGED"}}),1);
});
test("12 · Cobro concurrente repetido no duplica pagos ni stock y rechaza otra carga con la misma clave",async()=>{
  const session=await open(),id=await product(),s=await sale(id,session),key=randomUUID();const responses=await Promise.all([pay(s,session,undefined,key),pay(s,session,undefined,key)]);for(const r of responses)await value(r,201);
  assert.equal(await db.sale_payments.count({where:{sale_id:s.id}}),1);assert.equal((await stock(id)).on_hand,9);
  assert.equal((await pay(s,session,[{paymentMethod:"CASH",amountCents:999,cashReceivedCents:2000}],key)).status,409);
});
test("13 · Cancelación sin cobros libera stock; venta cobrada no admite cancelación ni reposición automática",async()=>{
  const session=await open(),id=await product(),s=await sale(id,session);await value(await http(`/api/sales/${s.id}/status`,{method:"PATCH",body:{status:"CANCELLED",cancellationReason:"Cancelación sintética sin cobros"}}));assert.equal((await stock(id)).reserved,0);assert.equal((await stock(id)).on_hand,10);
  const paid=await sale(id,session);await value(await pay(paid,session),201);assert.equal((await http(`/api/sales/${paid.id}/status`,{method:"PATCH",body:{status:"CANCELLED",cancellationReason:"No equivale a devolución física"}})).status,409);assert.equal((await stock(id)).on_hand,9);
});
test("14 · Cierre concurrente con cobro conserva el resultado completo de una sola transacción",async()=>{
  const session=await open(),id=await product(),s=await sale(id,session);
  const [payment,closing]=await Promise.all([pay(s,session),http(`/api/cash-register/${session.id}/close`,{method:"POST",body:{closingCountedCents:100,closingNotes:"Arqueo sintético durante concurrencia"}})]);
  assert.ok([201,409].includes(payment.status));const closed=await value(closing);const count=await db.sale_payments.count({where:{sale_id:s.id}});
  assert.equal(closed.cashPaymentsCents,count*1000);assert.equal(closed.expectedAmountCents,100+count*1000);assert.equal((await stock(id)).on_hand,10-count);assert.equal(await db.cash_register_movements.count({where:{session_id:session.id,movement_type:"PAYMENT"}}),count);
});
test("15 · Reintento simultáneo de creación produce una sola venta presencial",async()=>{
  const session=await open(),id=await product(),key=randomUUID(),body={operation:"SALE",branchId:a,cashSessionId:session.id,items:[{productId:id,quantity:1}]};
  const results=await Promise.all([http("/api/sales",{method:"POST",key,body}),http("/api/sales",{method:"POST",key,body})]);const sales=[];for(const r of results)sales.push(await value(r,201));assert.equal(sales[0].id,sales[1].id);assert.equal(await db.sale_items.count({where:{product_id:id}}),1);assert.equal((await stock(id)).reserved,1);
});
test("16 · Descuento aprobado permanece en su cotización y la autorización no puede reutilizarse en otra venta",async()=>{
  const session=await open(),id=await product();
  const authorization=await value(await http("/api/sales/discount-authorization",{method:"POST",body:{amountCents:100,reason:"Convenio sintético autorizado",authorizerEmail:evaluation.adminEmail,authorizerPassword:evaluation.password}}),201);
  const discount={amountCents:100,reason:"Convenio sintético autorizado",authorizationId:authorization.id};
  const quote=await sale(id,session,{operation:"QUOTATION",discount});assert.equal(quote.totalCents,900);
  assert.equal((await http("/api/sales",{method:"POST",body:{operation:"SALE",branchId:a,items:[{productId:id,quantity:1}],discount}})).status,409);
  const confirmed=await value(await http(`/api/sales/${quote.id}/confirm`,{method:"POST"}));assert.equal(confirmed.discount.amountCents,100);assert.equal(confirmed.totalCents,900);
  await value(await pay(quote,session,[{paymentMethod:"BANK_TRANSFER",amountCents:900,reference:"COBRO-CON-DESCUENTO-SINTETICO"}]),201);
});
