import { prisma } from "../db/prisma.js";

function formatDateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function dateOnly(value) {
  return value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
}

function guardian(row) {
  return row ? {
    email: row.email, firstNames: row.first_names, id: row.id,
    lastNames: row.last_names, phone: row.phone, relationship: row.relationship, rut: row.rut,
  } : null;
}

function mapPatient(row) {
  if (!row) return null;
  return {
    address: row.address, birthDate: formatDateOnly(row.birth_date), createdAt: row.created_at,
    email: row.email, firstNames: row.first_names, guardian: guardian(row.patient_guardians),
    id: row.id, lastNames: row.last_names, phone: row.phone, rut: row.rut, updatedAt: row.updated_at,
  };
}

function guardianData(value) {
  return {
    email: value.email, first_names: value.firstNames, last_names: value.lastNames,
    phone: value.phone, relationship: value.relationship, rut: value.rut,
  };
}

async function findPatientByIdWithClient(client, patientId) {
  return mapPatient(await client.patients.findUnique({
    include: { patient_guardians: true }, where: { id: patientId },
  }));
}

export async function createPatientWithGuardian(patientData, actorUserId) {
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

export async function findPatientById(patientId) {
  return findPatientByIdWithClient(prisma, patientId);
}

export async function listPatients({ page, pageSize, search }) {
  const where = search ? { OR: [
    { first_names: { contains: search, mode: "insensitive" } },
    { last_names: { contains: search, mode: "insensitive" } },
    { email: { contains: search, mode: "insensitive" } },
    { phone: { contains: search, mode: "insensitive" } },
    { rut: { contains: search.replace(/[.\s-]/g, ""), mode: "insensitive" } },
  ] } : {};
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

export async function updatePatientWithGuardian(patientId, patientData, actorUserId) {
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
