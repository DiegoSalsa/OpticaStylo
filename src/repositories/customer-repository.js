import { prisma } from "../db/prisma.js";
import { rutSearchValues } from "../utils/rut-search.js";
import {findCustomerByNormalizedRut} from "./customer-identity.js";
import {AppError} from "../utils/app-error.js";
import {retryTransaction} from "../db/retry-transaction.js";

function mapCustomer(row) {
  if (!row) return null;
  return {
    address: row.address,
    version:row.record_version,
    createdAt: row.created_at,
    email: row.email,
    firstNames: row.first_names,
    id: row.id,
    lastNames: row.last_names,
    patientId: row.patient_id,
    phone: row.phone,
    rut: row.rut,
    updatedAt: row.updated_at,
  };
}

export async function createCustomer(customer, actorUserId) {
  return retryTransaction(prisma,async(client)=>{
  await client.$queryRaw`SELECT set_config('stylo.customer_actor',${actorUserId},true)`;
  if(await findCustomerByNormalizedRut(client,customer.rut,{lock:true}))throw new AppError({code:"CUSTOMER_RUT_ALREADY_EXISTS",message:"Ya existe un cliente registrado con ese RUT.",status:409});
  return mapCustomer(await client.customers.create({ data: {
    address: customer.address,
    created_by: actorUserId,
    email: customer.email,
    first_names: customer.firstNames,
    last_names: customer.lastNames,
    patient_id: customer.patientId,
    phone: customer.phone,
    rut: customer.rut,
    updated_by: actorUserId,
  } }));
  });
}

export async function findCustomerById(customerId) {
  return mapCustomer(await prisma.customers.findUnique({ where: { id: customerId } }));
}

export async function listCustomers({ page, pageSize, search }) {
  const where = search ? { OR: [
    { first_names: { contains: search, mode: "insensitive" } },
    { last_names: { contains: search, mode: "insensitive" } },
    { email: { contains: search, mode: "insensitive" } },
    { phone: { contains: search, mode: "insensitive" } },
    ...rutSearchValues(search).map((value) => ({ rut: { contains: value, mode: "insensitive" } })),
  ] } : {};
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  const [items, total] = await prisma.$transaction([
    prisma.customers.findMany({
      orderBy: [{ last_names: "asc" }, { first_names: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      where,
    }),
    prisma.customers.count({ where }),
  ]);
  return {
    items: items.map(mapCustomer), page, pageSize, total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export async function updateCustomer(customerId, customer, actorUserId,expectedVersion) {
  return retryTransaction(prisma,async(client)=>{
  await client.$queryRaw`SELECT set_config('stylo.customer_actor',${actorUserId},true)`;
  await client.$queryRaw`SELECT id FROM customers WHERE id=${customerId}::uuid FOR UPDATE`;
  const existing = await client.customers.findUnique({ where: { id: customerId } });
  if (!existing) return null;
  if(expectedVersion!=null&&expectedVersion!==existing.record_version)throw new AppError({code:"CUSTOMER_VERSION_CONFLICT",message:"El cliente cambió en otra sesión. Recargue sus datos antes de guardar.",status:409});
  const duplicate=await findCustomerByNormalizedRut(client,customer.rut,{lock:true});
  if(duplicate&&duplicate.id!==customerId)throw new AppError({code:"CUSTOMER_RUT_ALREADY_EXISTS",message:"Ya existe un cliente registrado con ese RUT.",status:409});
  return mapCustomer(await client.customers.update({
    data: {
      address: customer.address,
      email: customer.email,
      first_names: customer.firstNames,
      last_names: customer.lastNames,
      phone: customer.phone,
      rut: customer.rut,
      updated_by: actorUserId,
    },
    where: { id: customerId },
  }));
  });
}
