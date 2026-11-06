import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {evaluation,requireEvaluationDatabase} from "../tests/evaluation-data.js";
import {inventoryDemo} from "../tests/inventory/data.js";
import {commercialDemo} from "../tests/customers/data.js";
requireEvaluationDatabase(process.env.DATABASE_URL,process.env.STORE_E2E_SCHEMA);
if(process.env.CUSTOMER_COMMERCIAL_TEST_MODE!=="true")throw new Error("La preparación comercial requiere el entorno sintético aislado.");
assert.match(process.env.EVALUATION_HTTP_URL,/^http:\/\/127\.0\.0\.1:(3119|3139)$/);
let cookie="";
async function request(url,body,method="GET"){
 const response=await fetch(process.env.EVALUATION_HTTP_URL+url,{method,headers:{cookie,"Content-Type":"application/json","X-Idempotency-Key":randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();assert.equal(result.success,true,`Falló la preparación sintética: ${response.status} ${result.error?.code??""}`);
 return {data:result.data,response};
}
cookie=(await request("/api/auth/login",{email:evaluation.adminEmail,password:evaluation.password},"POST")).response.headers.getSetCookie()[0].split(";")[0];
for(const [index,branchId] of inventoryDemo.branches.slice(0,2).entries()){
 const terminal=(await request("/api/cash-register/terminals",{branchId,name:`Caja demostración clientes ${index+1}`},"POST")).data;
 const session=(await request("/api/cash-register",{branchId,terminalId:terminal.id,openingAmountCents:0},"POST")).data;
 const sale=(await request("/api/sales",{operation:"SALE",branchId,cashSessionId:session.id,customerId:commercialDemo.customerId,items:[{productId:commercialDemo.products[0],quantity:1}]},"POST")).data;
 await request(`/api/sales/${sale.id}/payments`,{cashSessionId:session.id,payments:[{paymentMethod:"CASH",amountCents:1000,cashReceivedCents:1000}]},"POST");
 if(index===0)await request("/api/sales",{operation:"QUOTATION",branchId,cashSessionId:session.id,customerId:commercialDemo.customerId,items:[{productId:commercialDemo.products[1],quantity:1}]},"POST");
 await request(`/api/cash-register/${session.id}/close`,{closingCountedCents:1000,closingNotes:"Demostración sintética: venta registrada y caja cuadrada"},"POST");
}
const profile=(await request(`/api/customers/${commercialDemo.customerId}/profile`)).data;
assert.equal(profile.summary.purchaseCount,2);assert.equal(profile.summary.totalSpentCents,2000);assert.equal(profile.summary.branches.length,2);assert.equal(profile.summary.quotationCount,1);
console.log(`Demostración comercial preparada: ${commercialDemo.customer.rut}; dos compras reales del entorno sintético en sucursales A y B, total $2.000 y una cotización vigente.`);
