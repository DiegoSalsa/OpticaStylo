import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/db/prisma.js";
import { listSales, countSalesByStatus, findSaleById } from "../../src/repositories/sale-repository.js";
import { listProducts } from "../../src/repositories/product-repository.js";
import { listCustomers } from "../../src/repositories/customer-repository.js";
import { listPatients } from "../../src/repositories/patient-repository.js";
import { listUsers } from "../../src/repositories/user-repository.js";
import { changeSaleStatus, getSaleHistory } from "../../src/services/sale-service.js";
import { adminId, fixtureRut, managementId, seedManagementData } from "../fixtures/management-data.js";

test("integración PostgreSQL aislada: paginación y pedidos históricos", { skip: !process.env.STORE_E2E_SCHEMA }, async (t) => {
  try {
    await seedManagementData();
    await t.test("primera, intermedia y última página de cuatro directorios con más de cien registros", async () => {
      for (const [list,search] of [[listProducts,"Producto"],[listCustomers,"Cliente"],[listPatients,"Paciente"],[listUsers,"Usuario"]]) {
        for (const [page,length] of [[1,20],[4,20],[7,3]]) {
          const result = await list({page,pageSize:20,search});
          assert.equal(result.items.length,length);assert.equal(result.total,123);assert.equal(result.totalPages,7);
        }
        const empty = await list({page:1,pageSize:20,search:"inexistente"});
        assert.equal(empty.total,0);assert.equal(empty.items.length,0);assert.equal(empty.totalPages,0);
      }
    });
    await t.test("filtros combinados se aplican a todos los productos", async () => {
      const result = await listProducts({page:4,pageSize:20,search:"Producto",category:"FRAME",isActive:true});
      assert.equal(result.total,62);assert.equal(result.items.length,2);assert.ok(result.items.every((product)=>product.isActive));
    });
    await t.test("RUT con puntos o compacto encuentra clientes y pacientes con guion", async () => {
      for(const [list, index] of [[listCustomers,0],[listPatients,1000]]) {
        const rut=fixtureRut(index);
        for(const search of [rut,rut.replace("-",""),`${rut.slice(0,2)}.${rut.slice(2,5)}.${rut.slice(5)}`]) {
          assert.equal((await list({page:1,pageSize:20,search})).total,1);
        }
      }
    });
    await t.test("pedidos fuera de los primeros cien por nombre completo, número y RUT", async () => {
      const first = await findSaleById(managementId(5000));
      const recent = await listSales({page:1,pageSize:100,status:"PAID"});
      assert.equal(recent.items.some((item)=>item.id===first.id),false);
      for (const search of ["Cliente000 Prueba",String(first.saleNumber),fixtureRut(0)]) {
        const result = await listSales({page:1,pageSize:20,search,status:"PAID"});
        assert.equal(result.total,1);assert.equal(result.items[0].id,first.id);
      }
    });
    await t.test("compras invitadas se encuentran por nombre y RUT del carrito", async () => {
      for(const search of ["Invitada Histórica",fixtureRut(9000)]) {
        const result = await listSales({page:1,pageSize:20,search,origin:"ONLINE",status:"PENDING"});
        assert.equal(result.total,1);assert.equal(result.items[0].customer.firstNames,"Invitada");
      }
    });
    await t.test("cada columna consulta y cuenta su estado; resumen independiente de seis ventas", async () => {
      const summary = await countSalesByStatus({view:"active"});
      assert.equal(summary.inProcess,125);assert.equal(summary.byStatus.PAID,123);
      for(const status of ["PENDING","IN_PREPARATION","READY"]) assert.equal((await listSales({page:1,pageSize:20,status,view:"active"})).total,1);
      assert.equal((await listSales({page:4,pageSize:20,status:"PAID",origin:"ONLINE",view:"active"})).total,62);
    });
    await t.test("transición autorizada, rechazo e historial comercial", async () => {
      const actor={userId:adminId,permissions:["sales.read","sales.update"]};
      const saved = await changeSaleStatus(managementId(5001),{status:"IN_PREPARATION"},actor);
      assert.equal(saved.status,"IN_PREPARATION");assert.equal(saved.items[0].name,"Estuche de prueba");
      await assert.rejects(changeSaleStatus(saved.id,{status:"DELIVERED"},actor),(error)=>error.status===409);
      assert.equal((await getSaleHistory(saved.id,actor)).at(-1).newStatus,"IN_PREPARATION");
      await assert.rejects(changeSaleStatus(saved.id,{status:"READY"},{permissions:["sales.read"]}),(error)=>error.status===403);
      await changeSaleStatus(saved.id,{status:"READY"},actor);
      await changeSaleStatus(saved.id,{status:"DELIVERED"},actor);
      // Restore fixture through Prisma only inside the guarded temporary schema.
      await prisma.sales.update({where:{id:saved.id},data:{status:"PAID"}});
    });
    await t.test("cotizaciones en páginas posteriores conservan el detalle para recuperar el POS", async () => {
      const page=await listSales({page:7,pageSize:20,status:"QUOTATION"});
      assert.equal(page.items.length,3);assert.equal(page.total,123);
      const detail=await findSaleById(page.items[0].id);
      assert.equal(detail.status,"QUOTATION");assert.equal(detail.totalCents,5000);assert.equal(detail.items[0].quantity,1);
    });
  } finally { await prisma.$disconnect(); }
});
