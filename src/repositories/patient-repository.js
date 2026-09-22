import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con patient-repository.

// Transformar format date only al formato utilizado por el resto de la aplicación
function formatDateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

// Centralizar la lógica de date only para mantener consistente el comportamiento de la aplicación
function dateOnly(value) {
  return value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
}

// Centralizar la lógica de guardian para mantener consistente el comportamiento de la aplicación
function guardian(row) {
  return row ? {
    email: row.email, firstNames: row.first_names, id: row.id,
    lastNames: row.last_names, phone: row.phone, relationship: row.relationship, rut: row.rut,
  } : null;
}

// Transformar map paciente al formato utilizado por el resto de la aplicación
function mapPatient(row) {
  if (!row) return null;
  return {
    address: row.address, birthDate: formatDateOnly(row.birth_date), createdAt: row.created_at,
    email: row.email, firstNames: row.first_names, guardian: guardian(row.patient_guardians),
    id: row.id, lastNames: row.last_names, phone: row.phone, rut: row.rut, updatedAt: row.updated_at,
  };
}

// Centralizar la lógica de guardian datos para mantener consistente el comportamiento de la aplicación
function guardianData(value) {
  return {
    email: value.email, first_names: value.firstNames, last_names: value.lastNames,
    phone: value.phone, relationship: value.relationship, rut: value.rut,
  };
}

// Consultar find paciente by id with client y devolver los datos en el formato esperado por la capa llamadora
async function findPatientByIdWithClient(client, patientId) {
  return mapPatient(await client.patients.findUnique({
    include: { patient_guardians: true }, where: { id: patientId },
  }));
}

// Crear o registrar create paciente with guardian aplicando las reglas de negocio y persistencia correspondientes
export async function createPatientWithGuardian(patientData, actorUserId) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    const created = await client.patients.create({ data: {
      address: patientData.address, birth_date: dateOnly(patientData.birthDate),
      created_by: actorUserId, email: patientData.email, first_names: patientData.firstNames,
      last_names: patientData.lastNames, phone: patientData.phone,
      rut: patientData.rut, updated_by: actorUserId,
    } });
    if (patientData.guardian) {
      await client.patient_guardians.create({
        data: { ...guardianData(patientData.guardian), patient_id: created.id },
      });
    }
    return findPatientByIdWithClient(client, created.id);
  });
}

// Consultar find paciente by id y devolver los datos en el formato esperado por la capa llamadora
export async function findPatientById(patientId) {
  return findPatientByIdWithClient(prisma, patientId);
}

// Consultar list pacientes y devolver los datos en el formato esperado por la capa llamadora
export async function listPatients({ page, pageSize, search }) {
  const where = search ? { OR: [
    { first_names: { contains: search, mode: "insensitive" } },
    { last_names: { contains: search, mode: "insensitive" } },
    { email: { contains: search, mode: "insensitive" } },
    { phone: { contains: search, mode: "insensitive" } },
    { rut: { contains: search.replace(/[.\s-]/g, ""), mode: "insensitive" } },
  ] } : {};
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  const [rows, total] = await prisma.$transaction([
    prisma.patients.findMany({
      orderBy: [{ last_names: "asc" }, { first_names: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize, where,
    }),
    prisma.patients.count({ where }),
  ]);
  return {
    items: rows.map((row) => mapPatient({ ...row, patient_guardians: null })),
    page, pageSize, total, totalPages: total ? Math.ceil(total / pageSize) : 0,
  };
}

// Actualizar update paciente with guardian manteniendo las restricciones y estados permitidos del dominio
export async function updatePatientWithGuardian(patientId, patientData, actorUserId) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    const result = await client.patients.updateMany({ data: {
      address: patientData.address, birth_date: dateOnly(patientData.birthDate),
      email: patientData.email, first_names: patientData.firstNames,
      last_names: patientData.lastNames, phone: patientData.phone,
      rut: patientData.rut, updated_by: actorUserId,
    }, where: { id: patientId } });
    if (!result.count) return null;
    if (patientData.guardian) {
      await client.patient_guardians.upsert({
        create: { ...guardianData(patientData.guardian), patient_id: patientId },
        update: guardianData(patientData.guardian), where: { patient_id: patientId },
      });
    }
    return findPatientByIdWithClient(client, patientId);
  });
}
