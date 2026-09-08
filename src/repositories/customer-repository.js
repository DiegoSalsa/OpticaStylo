import { prisma } from "../db/prisma.js";

function mapCustomer(row) {
  if (!row) return null;
  return {
    address: row.address,
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
  return mapCustomer(await prisma.customers.create({ data: {
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
    { rut: { contains: search.replace(/[.\s-]/g, ""), mode: "insensitive" } },
  ] } : {};
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

export async function updateCustomer(customerId, customer, actorUserId) {
  const existing = await prisma.customers.findUnique({ select: { id: true }, where: { id: customerId } });
  if (!existing) return null;
  return mapCustomer(await prisma.customers.update({
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
}
