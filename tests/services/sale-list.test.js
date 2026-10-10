import assert from "node:assert/strict";
import test from "node:test";
import { getSale, getSaleHistory, getSaleList, getSaleSummary, changeSaleStatus } from "../../src/services/sale-service.js";
import { validateSaleListQuery } from "../../src/validations/sale-validation.js";
const id = "00000000-0000-4000-8000-000000000004";
const actor = {userId:id,permissions:["sales.read","sales.update"]};
test("valida filtros nuevos y mantiene parámetros históricos", () => {
  const query=validateSaleListQuery(new URLSearchParams("page=7&pageSize=20&origin=WEB&search=Ana%20%20Pérez&status=READY&view=active"));
  assert.equal(query.search,"Ana Pérez");assert.equal(query.origin,"ONLINE");assert.equal(query.status,"READY");assert.equal(query.page,7);
  assert.equal(validateSaleListQuery(new URLSearchParams("origin=POS")).origin,"IN_STORE");
  for(const params of ["view=invalid","origin=bad","status=bad","page=0","pageSize=101",`search=${"x".repeat(101)}`]) assert.throws(()=>validateSaleListQuery(new URLSearchParams(params)),(error)=>error.status===400);
});
test("lista y resumen delegan filtros validados al repositorio", async () => {
  const params = new URLSearchParams("search=Ana&status=READY&page=7");
  const query = validateSaleListQuery(params);
  const result = await getSaleList(params,actor,{listSales:async(value)=>{assert.deepEqual(value,query);return {items:[],total:243};}});
  assert.equal(result.total,243);
  assert.equal((await getSaleSummary(params,actor,{countSalesByStatus:async(value)=>{assert.deepEqual(value,query);return {total:243};}})).total,243);
});
test("detalle e historial requieren permiso comercial y conservan contratos", async () => {
  const sale = {id,items:[{name:"Marco"}],opticalAdditions:[]};
  assert.equal(await getSale(id,actor,{findSaleById:async()=>sale}),sale);
  assert.deepEqual(await getSaleHistory(id,actor,{findSaleById:async()=>sale,listSaleEvents:async()=>[{newStatus:"READY"}]}),[{newStatus:"READY"}]);
  for(const call of [()=>getSale(id,{permissions:[]}),()=>getSaleSummary(new URLSearchParams(),{permissions:["sales.reports_read"]}),()=>getSaleList(new URLSearchParams(),{permissions:[]})]) await assert.rejects(call,(error)=>error.status===403);
});
test("avance autorizado conserva la regla del backend y traduce rechazo", async () => {
  const saved = {id,status:"READY"};
  assert.equal(await changeSaleStatus(id,{status:"READY"},actor,{changeSaleStatus:async()=>({reason:null,sale:saved})}),saved);
  await assert.rejects(changeSaleStatus(id,{status:"DELIVERED"},actor,{changeSaleStatus:async()=>({reason:"INVALID_STATUS_TRANSITION",sale:null})}),(error)=>error.status===409);
  await assert.rejects(changeSaleStatus(id,{status:"READY"},{permissions:["sales.read"]}),(error)=>error.status===403);
});
