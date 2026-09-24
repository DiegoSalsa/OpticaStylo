import { prisma } from "../db/prisma.js";

const professionalUser = "users_professional_profiles_user_idTousers";

// Seleccionar únicamente la identidad comercial necesaria para resolver el vínculo.
const accountSelect = {
  email: true,
  customers: { select: { email: true, first_names: true, id: true, last_names: true, patient_id: true, rut: true } },
};

// Convertir fechas de nacimiento DATE a la representación pública estable del dominio.
function formatDateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

// Convertir valores Decimal de Prisma a números seguros para la respuesta pública.
function decimal(value) {
  return value == null ? null : Number(value);
}

// Crear la proyección mínima de paciente que puede conocer una cuenta comercial.
function publicPatient(row) {
  if (!row) return null;
  const rut = row.rut ?? "";
  return {
    firstNames: row.first_names,
    lastNames: row.last_names,
    rutMasked: rut.length > 4 ? `${"•".repeat(Math.max(0, rut.length - 4))}${rut.slice(-4)}` : rut,
  };
}

// Crear una reserva pública sin notas, eventos ni identificadores de actores internos.
export function mapCustomerClinicalAppointment(row) {
  const professional = row.professional_profiles?.[professionalUser];
  return {
    endAt: row.end_at,
    professional: professional ? {
      firstName: professional.first_name,
      lastName: professional.last_name,
    } : null,
    startAt: row.start_at,
    status: row.status,
  };
}

// Crear una receta pública deliberada sin exponer el encuentro clínico completo.
export function mapCustomerClinicalPrescription(row) {
  const issuer = row.professional_profiles?.[professionalUser];
  const replaced = row.other_optical_prescriptions?.length > 0;
  return {
    issuedAt: row.issued_at,
    professional: issuer ? { firstName: issuer.first_name, lastName: issuer.last_name } : null,
    leftEye: {
      addition: decimal(row.left_addition), axis: row.left_axis,
      cylinder: decimal(row.left_cylinder), sphere: decimal(row.left_sphere),
    },
    pupillaryDistance: decimal(row.pupillary_distance),
    rightEye: {
      addition: decimal(row.right_addition), axis: row.right_axis,
      cylinder: decimal(row.right_cylinder), sphere: decimal(row.right_sphere),
    },
    status: row.status === "ACTIVE" ? "ACTIVE" : replaced ? "REPLACED" : "VOIDED",
    fulfillmentNotes: row.fulfillment_notes,
  };
}

// Leer la cuenta y su relación existente sin aceptar identificadores enviados por el navegador.
export async function findCustomerClinicalContext(accountId) {
  return prisma.customer_accounts.findUnique({
    select: { ...accountSelect, id: true },
    where: { id: accountId },
  });
}

// Buscar un paciente verificable usando exclusivamente RUT, correo y fecha de nacimiento.
async function findVerifiablePatient(client, { birthDate, email, rut }) {
  return client.patients.findFirst({
    select: { birth_date: true, email: true, first_names: true, id: true, last_names: true, rut: true, customers: { select: { id: true } } },
    where: { birth_date: new Date(`${birthDate}T00:00:00.000Z`), email: { equals: email, mode: "insensitive" }, rut },
  });
}

// Vincular cuenta y paciente atómicamente para evitar carreras y sobrescrituras.
export async function linkCustomerToPatient(accountId, identity) {
  try {
    return await prisma.$transaction(async (client) => {
    const account = await client.customer_accounts.findUnique({ select: { ...accountSelect, id: true }, where: { id: accountId } });
    if (!account?.customers?.rut) return { reason: "IDENTITY" };
    const currentPatientId = account.customers.patient_id;
    const expectedEmail = account.email.trim().toLowerCase();
    if (identity.email && identity.email !== expectedEmail) return { reason: "IDENTITY" };

    if (currentPatientId) {
      const linked = await client.patients.findUnique({ select: { birth_date: true, email: true, first_names: true, id: true, last_names: true, rut: true }, where: { id: currentPatientId } });
      if (!linked || linked.rut !== account.customers.rut || linked.email.trim().toLowerCase() !== expectedEmail || formatDateOnly(linked.birth_date) !== identity.birthDate) {
        return { reason: "ALREADY_LINKED" };
      }
      return { patient: publicPatient(linked), reason: null };
    }

    const patient = await findVerifiablePatient(client, { birthDate: identity.birthDate, email: expectedEmail, rut: account.customers.rut });
    if (!patient) return { reason: "IDENTITY" };
    if (patient.customers && patient.customers.id !== account.customers.id) return { reason: "PATIENT_LINKED" };

    const updated = await client.customers.updateMany({ data: { patient_id: patient.id }, where: { id: account.customers.id, patient_id: null } });
    if (!updated.count) {
      const latest = await client.customers.findUnique({ select: { patient_id: true }, where: { id: account.customers.id } });
      if (latest?.patient_id === patient.id) return { patient: publicPatient(patient), reason: null };
      return { reason: "ALREADY_LINKED" };
    }
    return { patient: publicPatient(patient), reason: null };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    // Traducir conflictos concurrentes de la restricción única a un resultado de dominio seguro.
    if (error?.code === "P2002" || error?.code === "P2034") return { reason: "PATIENT_LINKED" };
    throw error;
  }
}

// Obtener reservas y recetas mediante proyecciones independientes del expediente clínico.
export async function findCustomerClinicalOverview(accountId, now = new Date()) {
  const account = await findCustomerClinicalContext(accountId);
  const patientId = account?.customers?.patient_id;
  const patient = patientId ? await prisma.patients.findUnique({ select: { first_names: true, last_names: true, rut: true }, where: { id: patientId } }) : null;
  if (!patientId || !patient) return { linked: false, patient: null, upcomingAppointments: [], appointmentHistory: [], prescriptions: { active: [], history: [] } };

  const [appointments, prescriptions] = await Promise.all([
    prisma.appointments.findMany({
      orderBy: [{ start_at: "asc" }, { id: "asc" }],
      select: { end_at: true, id: true, professional_profiles: { select: { [professionalUser]: { select: { first_name: true, last_name: true } } } }, start_at: true, status: true },
      where: { patient_id: patientId },
    }),
    prisma.optical_prescriptions.findMany({
      orderBy: [{ issued_at: "desc" }, { version: "desc" }],
      select: {
        fulfillment_notes: true, issued_at: true, left_addition: true, left_axis: true, left_cylinder: true, left_sphere: true,
        other_optical_prescriptions: { select: { status: true } }, professional_profiles: { select: { [professionalUser]: { select: { first_name: true, last_name: true } } } },
        pupillary_distance: true, right_addition: true, right_axis: true, right_cylinder: true, right_sphere: true, status: true,
      },
      where: { status: { in: ["ACTIVE", "VOIDED"] }, clinical_encounters: { patient_id: patientId, status: "FINALIZED" } },
    }),
  ]);

  const publicAppointments = appointments.map(mapCustomerClinicalAppointment);
  const publicPrescriptions = prescriptions.map(mapCustomerClinicalPrescription);
  return {
    appointmentHistory: publicAppointments.filter((item) => item.startAt < now || item.status === "CANCELLED"),
    linked: true,
    patient: publicPatient(patient),
    prescriptions: {
      active: publicPrescriptions.filter((item) => item.status === "ACTIVE"),
      history: publicPrescriptions.filter((item) => item.status !== "ACTIVE"),
    },
    upcomingAppointments: publicAppointments.filter((item) => item.startAt >= now && item.status !== "CANCELLED"),
  };
}
