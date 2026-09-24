import { prisma } from "../db/prisma.js";
import { randomUUID } from "node:crypto";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";
import {
  CUSTOMER_PATIENT_OTP_MAX_ATTEMPTS,
  CUSTOMER_PATIENT_OTP_TTL_SECONDS,
  generateCustomerPatientOtp,
  hashCustomerPatientOtp,
  maskCustomerPatientEmail,
  verifyCustomerPatientOtp,
} from "../utils/customer-patient-otp.js";

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
export async function findCustomerClinicalContext(accountId, database = prisma) {
  return database.customer_accounts.findUnique({
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

// Crear un desafío OTP después de verificar la identidad contra la cuenta autenticada.
export async function createCustomerPatientOtpChallenge(accountId, identity, dependencies = {}) {
  try {
    const database = dependencies.client ?? prisma;
    return await database.$transaction(async (client) => {
    const account = await client.customer_accounts.findUnique({ select: { ...accountSelect, id: true }, where: { id: accountId } });
    if (!account?.customers?.rut) return { reason: "IDENTITY" };
    const expectedEmail = account.email.trim().toLowerCase();
    if (account.customers.patient_id) {
      const linked = await client.patients.findUnique({ select: { birth_date: true, email: true, first_names: true, id: true, last_names: true, rut: true }, where: { id: account.customers.patient_id } });
      if (!linked || linked.rut !== account.customers.rut || linked.email.trim().toLowerCase() !== expectedEmail || formatDateOnly(linked.birth_date) !== identity.birthDate) return { reason: "IDENTITY" };
      return { patient: publicPatient(linked), reason: "ALREADY_LINKED", samePatient: true };
    }
    const patient = await findVerifiablePatient(client, { birthDate: identity.birthDate, email: expectedEmail, rut: account.customers.rut });
    if (!patient) return { reason: "IDENTITY" };
    if (patient.customers && patient.customers.id !== account.customers.id) return { reason: "PATIENT_LINKED" };

    // Invalidar desafíos anteriores para que solo exista un código válido por cuenta.
    const now = dependencies.now?.() ?? new Date();
    await client.customer_patient_link_challenges.updateMany({
      data: { consumed_at: now },
      where: { account_id: account.id, consumed_at: null },
    });
    const challengeId = (dependencies.createChallengeId ?? randomUUID)();
    const code = (dependencies.generateCode ?? generateCustomerPatientOtp)();
    const expiresAt = new Date(now.getTime() + CUSTOMER_PATIENT_OTP_TTL_SECONDS * 1000);
    const codeHash = (dependencies.hashCode ?? hashCustomerPatientOtp)(challengeId, code, dependencies.environment);
    await client.customer_patient_link_challenges.create({ data: {
      account_id: account.id, code_hash: codeHash, expires_at: expiresAt, id: challengeId, patient_id: patient.id,
    } });
    // Encolar el correo en la infraestructura transaccional existente y no usar el receptor del navegador.
    await client.transactional_email_outbox.create({ data: {
      account_id: account.id,
      deduplication_key: transactionalEmailDeduplicationKey("CUSTOMER_PATIENT_OTP", challengeId),
      payload: { code },
      recipient_email: patient.email,
      template_code: "CUSTOMER_PATIENT_OTP",
    } });
    return {
      expiresAt, maskedEmail: maskCustomerPatientEmail(patient.email), reason: null,
    };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    // Traducir conflictos concurrentes de la restricción única a un resultado de dominio seguro.
    if (error?.code === "P2002" || error?.code === "P2034") return { reason: "PATIENT_LINKED" };
    throw error;
  }
}

// Verificar el OTP y vincular la relación solo después de demostrar posesión del correo.
export async function verifyCustomerPatientOtpChallenge(accountId, code, dependencies = {}) {
  const database = dependencies.client ?? prisma;
  try {
    return await database.$transaction(async (client) => {
    const now = dependencies.now?.() ?? new Date();
    const challenge = await client.customer_patient_link_challenges.findFirst({
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      where: { account_id: accountId, consumed_at: null },
    });
    if (!challenge || challenge.expires_at <= now || challenge.attempt_count >= CUSTOMER_PATIENT_OTP_MAX_ATTEMPTS) {
      return { reason: "OTP_INVALID" };
    }
    const valid = (dependencies.verifyCode ?? verifyCustomerPatientOtp)(challenge.id, code, challenge.code_hash, dependencies.environment);
    if (!valid) {
      await client.customer_patient_link_challenges.updateMany({
        data: { attempt_count: { increment: 1 } },
        where: { attempt_count: { lt: CUSTOMER_PATIENT_OTP_MAX_ATTEMPTS }, consumed_at: null, id: challenge.id },
      });
      return { reason: "OTP_INVALID" };
    }
    const account = await client.customer_accounts.findUnique({ select: { customer_id: true, customers: { select: { patient_id: true } } }, where: { id: accountId } });
    if (!account) return { reason: "IDENTITY" };
    const patient = await client.patients.findUnique({
      select: { birth_date: true, email: true, first_names: true, id: true, last_names: true, rut: true, customers: { select: { id: true } } },
      where: { id: challenge.patient_id },
    });
    if (!patient || (patient.customers && patient.customers.id !== account.customer_id)) {
      await client.customer_patient_link_challenges.updateMany({ data: { consumed_at: now }, where: { id: challenge.id, consumed_at: null } });
      return { reason: "PATIENT_LINKED" };
    }
    if (account.customers.patient_id && account.customers.patient_id !== patient.id) {
      await client.customer_patient_link_challenges.updateMany({ data: { consumed_at: now }, where: { id: challenge.id, consumed_at: null } });
      return { reason: "ALREADY_LINKED" };
    }
    const updated = await client.customers.updateMany({ data: { patient_id: patient.id }, where: { id: account.customer_id, patient_id: null } });
    await client.customer_patient_link_challenges.updateMany({ data: { consumed_at: now }, where: { id: challenge.id, consumed_at: null } });
    if (!updated.count && account.customers.patient_id !== patient.id) return { reason: "ALREADY_LINKED" };
    return { patient: publicPatient(patient), reason: null };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    // Traducir una carrera de vinculación protegida por la restricción UNIQUE a un conflicto seguro.
    if (error?.code === "P2002" || error?.code === "P2034") return { reason: "PATIENT_LINKED" };
    throw error;
  }
}

// Obtener reservas y recetas mediante proyecciones independientes del expediente clínico.
export async function findCustomerClinicalOverview(accountId, now = new Date(), dependencies = {}) {
  const database = dependencies.client ?? prisma;
  const account = await findCustomerClinicalContext(accountId, database);
  const patientId = account?.customers?.patient_id;
  const patient = patientId ? await database.patients.findUnique({ select: { first_names: true, last_names: true, rut: true }, where: { id: patientId } }) : null;
  if (!patientId || !patient) return { linked: false, patient: null, upcomingAppointments: [], appointmentHistory: [], prescriptions: { active: [], history: [] } };

  const [appointments, prescriptions] = await Promise.all([
    database.appointments.findMany({
      orderBy: [{ start_at: "asc" }, { id: "asc" }],
      select: { end_at: true, id: true, professional_profiles: { select: { [professionalUser]: { select: { first_name: true, last_name: true } } } }, start_at: true, status: true },
      where: { patient_id: patientId },
    }),
    database.optical_prescriptions.findMany({
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
