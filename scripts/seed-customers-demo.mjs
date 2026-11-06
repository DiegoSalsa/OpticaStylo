import { prisma } from "../src/db/prisma.js";
import { hashPassword } from "../src/auth/password.js";
import { evaluation, requireEvaluationDatabase } from "../tests/evaluation-data.js";
import { inventoryDemo } from "../tests/inventory/data.js";
import { commercialDemo as d } from "../tests/customers/data.js";
import { mutateInventory } from "../src/repositories/inventory-repository.js";
requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
if (process.env.CUSTOMER_COMMERCIAL_TEST_MODE !== "true") throw new Error("El escenario comercial requiere el clúster aislado.");
try {
  for (const [index, id] of d.products.entries()) {
    await prisma.products.create({data:{id,sku:`CLI-DEMO-${index+1}`,name:`Armazón comercial sintético ${index+1}`,category:"FRAME",inventory_mode:"TRACKED",unit_price_cents:1000,created_by:evaluation.adminId,updated_by:evaluation.adminId,is_test_data:true}});
    for (const branchId of inventoryDemo.branches.slice(0,2)) await mutateInventory({branchId,productId:id,kind:"COUNT",quantity:100,expectedVersion:null,reason:"Conteo exclusivo de pruebas comerciales"},{userId:evaluation.adminId,permissions:["inventory.manage_all"]},`clientes:${branchId}:${id}`.slice(-80));
  }
  await prisma.customers.create({
    data: {
      id: d.customerId,
      first_names: d.customer.firstNames,
      last_names: d.customer.lastNames,
      rut: d.customer.rut,
      email: d.customer.email,
      phone: d.customer.phone,
      address: d.customer.address,
      created_by: evaluation.adminId,
      updated_by: evaluation.adminId
    }
  });
  await prisma.users.create({
    data: {
      id: d.staffBId,
      email: d.staffBEmail,
      first_name: "Ventas sintéticas",
      last_name: "Sucursal B",
      password_hash: await hashPassword(evaluation.password)
    }
  });
  const role = await prisma.roles.findUniqueOrThrow({
    where: {
      code: "SALES"
    }
  });
  await prisma.user_roles.create({
    data: {
      user_id: d.staffBId,
      role_id: role.id
    }
  });
  await prisma.user_branches.create({
    data: {
      user_id: d.staffBId,
      branch_id: inventoryDemo.branches[1]
    }
  });
  console.log("Cliente comercial y vendedor de segunda sucursal preparados con identidades sintéticas.");
} finally {
  await prisma.$disconnect();
}
