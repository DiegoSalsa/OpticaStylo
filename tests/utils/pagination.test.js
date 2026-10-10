import assert from "node:assert/strict";
import test from "node:test";
import { createRequestGate, pageNumbers, paginationReducer, resourceUrl, visibleRange } from "../../src/utils/pagination.js";

test("rangos de cero, menos de veinte y más de cien registros", () => {
  for (const [page, total, length, first, last] of [[1,0,0,0,0],[1,7,7,1,7],[1,243,20,1,20],[7,243,20,121,140],[13,243,3,241,243]]) {
    assert.deepEqual(visibleRange({page, total, pageSize:20, items:Array(length)}), {first,last});
  }
});
test("cambiar búsqueda o filtro reinicia la página y conserva otros filtros", () => {
  const state = { page:7, revision:0, filters:{search:"Marco",category:"FRAME"} };
  assert.deepEqual(paginationReducer(state,{type:"filters",filters:{search:"Cristal"}}),{...state,page:1,filters:{search:"Cristal",category:"FRAME"}});
  assert.equal(paginationReducer(state,{type:"filters",filters:{search:"Marco"}}),state);
});
test("recargar después de crear o editar conserva contexto y página", () => {
  const state = { page:6, revision:0, filters:{search:"Ana"} };
  assert.deepEqual(paginationReducer(state,{type:"reload"}),{...state,revision:1});
  assert.equal(paginationReducer(state,{type:"page",page:0}).page,1);
});
test("consulta paginada combina filtros y conserva parámetros del endpoint", () => {
  const params = new URL(resourceUrl("/api/sales?status=QUOTATION",{search:"Ana & Pedro",origin:"IN_STORE"},6),"https://test.invalid").searchParams;
  assert.equal(params.get("page"),"6"); assert.equal(params.get("pageSize"),"20");
  assert.equal(params.get("search"),"Ana & Pedro"); assert.equal(params.get("status"),"QUOTATION");
  assert.equal(params.get("origin"),"IN_STORE");
});
test("navegación acotada en primera, intermedia y última página", () => {
  assert.deepEqual(pageNumbers(1,13),[1,2,3,4,5]);
  assert.deepEqual(pageNumbers(7,13),[5,6,7,8,9]);
  assert.deepEqual(pageNumbers(13,13),[9,10,11,12,13]);
  assert.deepEqual(pageNumbers(1,0),[]);
});
test("respuestas atrasadas no pueden sobrescribir la selección ni el reinicio", async () => {
  const gate = createRequestGate();
  const productA = gate.begin();
  const productB = gate.begin();
  assert.equal(productA.signal.aborted,true);
  let currentImages = [];
  if(productB.isCurrent()) currentImages = ["B"];
  await Promise.resolve();
  if(productA.isCurrent()) currentImages = ["A"];
  assert.deepEqual(currentImages,["B"]);
  gate.cancel();
  assert.equal(productB.isCurrent(),false);
});
