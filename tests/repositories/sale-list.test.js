import assert from "node:assert/strict";
import test from "node:test";
import { countSalesByStatus, listSales, saleListInclude, saleListWhere } from "../../src/repositories/sale-repository.js";

test("Prisma busca por número, nombre completo y RUT del cliente o carrito invitado", () => {
  const byNumber = saleListWhere({search:"#123"});
  assert.equal(byNumber.OR[0].sale_number,123n);
  const byName = saleListWhere({search:"Ana Pérez"});
  assert.equal(byName.OR[0].customers.is.OR[0].AND.length,2);
  assert.equal(byName.OR[1].store_carts.is.OR[0].AND.length,2);
  const byRut = saleListWhere({search:"12.345.678-5"});
  assert.equal(byRut.OR[0].customers.is.OR[1].rut.contains,"123456785");
  assert.equal(byRut.OR[1].store_carts.is.OR[1].buyer_rut.contains,"123456785");
  assert.equal(saleListWhere({search:"---"}).OR[0].customers.is.OR.length,1);
});
test("origen, vista y estado se intersectan; no amplían la vista activa", () => {
  const where = saleListWhere({origin:"ONLINE",view:"active",status:"READY"});
  assert.equal(where.origin,"ONLINE"); assert.deepEqual(where.AND,[{status:"READY"}]);
  assert.deepEqual(where.status.in,["PENDING","PAID","IN_PREPARATION","READY"]);
  assert.deepEqual(saleListWhere({view:"delivered"}).status.in,["DELIVERED"]);
  assert.ok(saleListWhere({view:"history"}).status.in.includes("CANCELLED"));
});
test("listado posterior a cien usa skip/take y el mismo filtro para conteo", async () => {
  let args, countArgs, isolation;
  const row = {id:"guest",origin:"ONLINE",sale_number:121n,total_cents:5000n,subtotal_cents:5000n,shipping_fee_cents:0n,sale_payments:[{amount_cents:2000n}],sale_receipts:[],store_carts:{buyer_first_names:"Invitado",buyer_last_names:"Prueba",buyer_rut:"123456785"},status:"READY"};
  const client = { sales: {findMany: (value) => {args=value;return [row];},count:(value)=>{countArgs=value;return 243;}}, $transaction:async(values, options)=>{isolation=options;return Promise.all(values);} };
  const result = await listSales({page:7,pageSize:20,search:"Invitado",origin:"ONLINE",status:"READY"},client);
  assert.equal(args.skip,120);assert.equal(args.take,20);assert.deepEqual(args.where,countArgs.where);
  assert.equal(isolation.isolationLevel,"RepeatableRead");
  assert.equal(result.total,243);assert.equal(result.totalPages,13);assert.equal(result.page,7);
  assert.equal(result.items[0].customer.firstNames,"Invitado");assert.equal(result.items[0].paidCents,2000);assert.equal(result.items[0].balanceCents,3000);
  assert.equal(result.items[0].items,undefined);assert.equal(result.items[0].payments,undefined);
  assert.equal(saleListInclude.sale_items,undefined); assert.equal(saleListInclude.sale_optical_additions,undefined);
  assert.equal(saleListInclude.external_prescriptions.select.confirmed_data,undefined);
  assert.equal(saleListInclude.sale_receipts.take,1);
});
test("conteo de todos los estados es independiente de las ventas recientes", async () => {
  let args;
  const data = await countSalesByStatus({view:"active",search:"Ana"},{sales:{groupBy:async(value)=>{args=value;return [{status:"PENDING",_count:{_all:8}},{status:"PAID",_count:{_all:102}},{status:"IN_PREPARATION",_count:{_all:24}},{status:"READY",_count:{_all:17}}];}}});
  assert.deepEqual(args.by,["status"]); assert.deepEqual(args.where,saleListWhere({view:"active",search:"Ana"}));
  assert.equal(data.inProcess,143);assert.equal(data.total,151);assert.equal(data.byStatus.PAID,102);
});
test("listado y resumen vacío mantienen los metadatos reales", async () => {
  const client = {sales:{findMany:()=>[],count:()=>0,groupBy:async()=>[]},$transaction:async(values)=>Promise.all(values)};
  assert.deepEqual(await listSales({page:1,pageSize:20},client),{items:[],page:1,pageSize:20,total:0,totalPages:0});
  assert.deepEqual(await countSalesByStatus({},client),{byStatus:{},inProcess:0,total:0});
});
