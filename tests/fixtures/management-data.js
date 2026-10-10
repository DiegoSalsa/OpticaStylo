import { prisma } from "../../src/db/prisma.js";
import { seedStoreE2e, requireIsolatedStoreDatabase, ids as storeIds } from "../../scripts/seed-store-e2e.mjs";

export const managementId = (index) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const adminId = managementId(1);
export const salesUserId = managementId(2);

export function fixtureRut(index) {
  const body = String(20000000 + index);
  let sum = 0, factor = 2;
  for (const digit of [...body].reverse()) { sum += Number(digit) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const digit = 11 - sum % 11;
  return `${body}-${digit === 11 ? "0" : digit === 10 ? "K" : digit}`;
}

export async function seedManagementData() {
  requireIsolatedStoreDatabase();
  await seedStoreE2e();
  for (const [id,roleCode] of [[adminId,"ADMIN"],[salesUserId,"SALES"]]) {
    await prisma.users.upsert({where:{id},update:{},create:{id,email:`management-${roleCode.toLowerCase()}@example.invalid`,password_hash:"fixture-password-never-used-2026",first_name:"Gestión",last_name:roleCode}});
    const role = await prisma.roles.findUnique({where:{code:roleCode}});
    await prisma.user_roles.upsert({where:{user_id_role_id:{user_id:id,role_id:role.id}},update:{},create:{user_id:id,role_id:role.id}});
  }
  const customers = [], patients = [], users = [], products = [], sales = [], items = [], payments = [];
  for (let index = 0; index < 123; index += 1) {
    const suffix = String(index).padStart(3,"0");
    customers.push({id:managementId(1000+index),rut:fixtureRut(index),first_names:`Cliente${suffix}`,last_names:"Prueba",email:`cliente${suffix}@example.invalid`,phone:"+56912345678",address:"Calle de prueba 123"});
    patients.push({id:managementId(2000+index),rut:fixtureRut(1000+index),first_names:`Paciente${suffix}`,last_names:"Prueba",email:`paciente${suffix}@example.invalid`,phone:"+56912345678",address:"Calle de prueba 123",birth_date:new Date("1990-01-01")});
    users.push({id:managementId(3000+index),first_name:`Usuario${suffix}`,last_name:"Prueba",email:`usuario${suffix}@example.invalid`,password_hash:"fixture-password-never-used-2026"});
    products.push({id:managementId(4000+index),sku:`GESTION-${suffix}`,name:`Producto${suffix}`,category:"FRAME",unit_price_cents:5000,is_active:index%2===0,created_by:adminId,updated_by:adminId});
    for (const [offset,status] of [[5000,"PAID"],[6000,"QUOTATION"]]) {
      const id = managementId(offset+index);
      sales.push({id,customer_id:managementId(1000+index),status,origin:index%2===0?"ONLINE":"IN_STORE",subtotal_cents:5000,total_cents:5000,fulfillment_method:"PICKUP",created_by:adminId,created_at:new Date(Date.UTC(2026,9,1,0,index)),quotation_valid_until:status==="QUOTATION"?new Date("2099-01-01"):null});
      items.push({sale_id:id,product_id:storeIds.accessory,product_name:"Estuche de prueba",product_sku:"ESTUCHE-TEST",product_category:"ACCESSORY",requires_prescription:false,quantity:1,unit_price_cents:5000,position:1});
      if(status==="PAID") payments.push({sale_id:id,amount_cents:5000,payment_method:"BANK_TRANSFER",reference:"Fixture",received_by:adminId});
    }
  }
  await prisma.customers.createMany({data:customers,skipDuplicates:true});
  await prisma.patients.createMany({data:patients,skipDuplicates:true});
  await prisma.users.createMany({data:users,skipDuplicates:true});
  const salesRole = await prisma.roles.findUnique({where:{code:"SALES"}});
  await prisma.user_roles.createMany({data:users.map((user)=>({user_id:user.id,role_id:salesRole.id})),skipDuplicates:true});
  await prisma.products.createMany({data:products,skipDuplicates:true});
  await prisma.sales.createMany({data:sales,skipDuplicates:true});
  await prisma.sale_items.createMany({data:items});
  await prisma.sale_payments.createMany({data:payments});
  for (const [index,status] of ["PENDING","IN_PREPARATION","READY","DELIVERED","CANCELLED"].entries()) {
    await prisma.sales.create({data:{id:managementId(7000+index),status,subtotal_cents:5000,total_cents:5000,origin:"ONLINE",fulfillment_method:"PICKUP",...(status==="CANCELLED"?{cancellation_reason:"Fixture",cancelled_at:new Date()}:{})}});
  }
  // Guest buyer identity is commercial data stored in the cart, with no patient.
  await prisma.store_carts.create({data:{sale_id:managementId(7000),status:"CHECKED_OUT",checked_out_at:new Date(),token_hash:"a".repeat(64),buyer_first_names:"Invitada",buyer_last_names:"Histórica",buyer_rut:fixtureRut(9000),buyer_email:"invitada@example.invalid",buyer_phone:"+56912345678",buyer_address:"Calle de prueba 123",fulfillment_method:"PICKUP",expires_at:new Date("2099-01-01")}});
}
