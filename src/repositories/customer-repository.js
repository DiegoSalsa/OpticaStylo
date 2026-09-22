import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con customer-repository.

// Transformar map cliente al formato utilizado por el resto de la aplicación
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

// Crear o registrar create cliente aplicando las reglas de negocio y persistencia correspondientes
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

// Consultar find cliente by id y devolver los datos en el formato esperado por la capa llamadora
export async function findCustomerById(customerId) {
  return mapCustomer(await prisma.customers.findUnique({ where: { id: customerId } }));
}

// Consultar list clientes y devolver los datos en el formato esperado por la capa llamadora
export async function listCustomers({ page, pageSize, search }) {
  const where = search ? { OR: [
    { first_names: { contains: search, mode: "insensitive" } },
    { last_names: { contains: search, mode: "insensitive" } },
    { email: { contains: search, mode: "insensitive" } },
    { phone: { contains: search, mode: "insensitive" } },
    { rut: { contains: search.replace(/[.\s-]/g, ""), mode: "insensitive" } },
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

// Actualizar update cliente manteniendo las restricciones y estados permitidos del dominio
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
