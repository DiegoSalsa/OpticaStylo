import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { adultBirthDateCutoff, isAdultBirthDate } from "../utils/customer-account-age.js";
import {
  CUSTOMER_PATIENT_OTP_MAX_ATTEMPTS, CUSTOMER_PATIENT_OTP_TTL_SECONDS,
  generateCustomerPatientOtp, hashCustomerPatientOtp, maskCustomerPatientEmail, verifyCustomerPatientOtp,
} from "../utils/customer-patient-otp.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

const includeAccount = { customers: { include: { patients: { select: { birth_date: true } } } } };

async function adultAccount(client, id) {
  const account = await client.customer_accounts.findUnique({ where: { id, is_active: true }, include: includeAccount });
  const birthDate = account?.birth_date ?? account?.customers.patients?.birth_date;
  if (!account || !isAdultBirthDate(birthDate)) return null;
  if (!account.birth_date) await client.customer_accounts.update({ where: { id }, data: { birth_date: birthDate } });
  return account;
}

function representedPatientWhere(account, dependant) {
  return {
    rut: dependant.rut, birth_date: dependant.birth_date,
    patient_guardians: {
      rut: account.customers.rut, email: { equals: account.email, mode: "insensitive" },
      OR: [{ account_id: null }, { account_id: account.id }],
    },
  };
}

async function bindDependant(client, account, dependant, patientId) {
  const linked = await client.patient_guardians.updateMany({
    where: { patient_id: patientId, ...representedPatientWhere(account, dependant).patient_guardians },
    data: { account_id: account.id },
  });
  if (!linked.count) return false;
  await client.customer_dependants.update({ where: { id: dependant.id }, data: { patient_id: patientId } });
  return true;
}

export async function synchronizeAccountClinicalLinks(accountId) {
  return retryTransaction(prisma, async (client) => {
    const account = await adultAccount(client, accountId);
    if (!account?.email_verified_at) return;
    const ownPatient = await client.patients.findFirst({
      where: { rut: account.customers.rut, birth_date: account.birth_date ?? account.customers.patients?.birth_date, email: { equals: account.email, mode: "insensitive" } },
      select: { id: true, customers: { select: { id: true } } },
    });
    if (ownPatient && (!ownPatient.customers || ownPatient.customers.id === account.customer_id)
      && (!account.customers.patient_id || account.customers.patient_id === ownPatient.id)) {
      await client.customers.updateMany({ where: { id: account.customer_id, OR: [{ patient_id: null }, { patient_id: ownPatient.id }] }, data: { patient_id: ownPatient.id } });
      await client.customer_accounts.update({ where: { id: account.id }, data: { clinical_link_recheck_required: false } });
    }
    const dependants = await client.customer_dependants.findMany({ where: { account_id: accountId, birth_date: { gt: adultBirthDateCutoff() } } });
    for (const dependant of dependants) {
      const patient = await client.patients.findFirst({ where: representedPatientWhere(account, dependant), select: { id: true } });
      if (patient) await bindDependant(client, account, dependant, patient.id);
    }
  });
}

export async function listAccountDependants(accountId) {
  await synchronizeAccountClinicalLinks(accountId);
  const rows = await prisma.customer_dependants.findMany({
    where: { account_id: accountId }, orderBy: [{ first_names: "asc" }, { id: "asc" }], take: 50,
    include: { patient: { select: { birth_date: true, patient_guardians: { select: { account_id: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id, rut: row.rut, firstNames: row.first_names, lastNames: row.last_names,
    birthDate: row.birth_date.toISOString().slice(0, 10), relationship: row.relationship,
    isMinor: !isAdultBirthDate(row.birth_date),
    linked: Boolean(row.patient && !isAdultBirthDate(row.patient.birth_date) && row.patient.patient_guardians?.account_id === accountId),
  }));
}

export async function createAccountDependant(accountId, input) {
  return retryTransaction(prisma, async (client) => {
    if (!await adultAccount(client, accountId)) return null;
    return client.customer_dependants.create({ data: {
      account_id: accountId, birth_date: new Date(input.birthDate + "T00:00:00.000Z"),
      first_names: input.firstNames, last_names: input.lastNames, rut: input.rut, relationship: input.guardian.relationship,
    }, select: { id: true } });
  });
}

export async function findAccountDependant(accountId, id, client = prisma) {
  return client.customer_dependants.findFirst({ where: { id, account_id: accountId } });
}

export async function createDependantLinkChallenge(accountId, dependantId, environment = process.env) {
  return retryTransaction(prisma, async (client) => {
    const account = await adultAccount(client, accountId);
    const dependant = await findAccountDependant(accountId, dependantId, client);
    if (!account || !dependant || isAdultBirthDate(dependant.birth_date)) return null;
    const patient = await client.patients.findFirst({ where: representedPatientWhere(account, dependant), select: { id: true, patient_guardians: { select: { email: true } } } });
    if (!patient) return null;
    const now = new Date();
    await client.customer_patient_link_challenges.updateMany({ where: { account_id: accountId, dependant_id: dependantId, consumed_at: null }, data: { consumed_at: now } });
    const challengeId = randomUUID();
    const code = generateCustomerPatientOtp();
    const expiresAt = new Date(now.getTime() + CUSTOMER_PATIENT_OTP_TTL_SECONDS * 1000);
    const recipient = patient.patient_guardians.email.trim().toLowerCase();
    await client.customer_patient_link_challenges.create({ data: {
      id: challengeId, account_id: accountId, dependant_id: dependantId, patient_id: patient.id,
      recipient_email: recipient, code_hash: hashCustomerPatientOtp(challengeId, code, environment), expires_at: expiresAt,
    } });
    const email = await client.transactional_email_outbox.create({ data: {
      account_id: accountId, recipient_email: recipient, template_code: "CUSTOMER_PATIENT_OTP",
      deduplication_key: transactionalEmailDeduplicationKey("CUSTOMER_PATIENT_OTP", challengeId), payload: { challengeId, code },
    } });
    return { outboxId: email.id, maskedEmail: maskCustomerPatientEmail(recipient), expiresAt };
  });
}

export async function verifyDependantLinkChallenge(accountId, dependantId, code, environment = process.env) {
  return retryTransaction(prisma, async (client) => {
    const now = new Date();
    const challenge = await client.customer_patient_link_challenges.findFirst({ where: { account_id: accountId, dependant_id: dependantId, consumed_at: null }, orderBy: [{ created_at: "desc" }, { id: "desc" }] });
    if (!challenge || challenge.expires_at <= now || challenge.attempt_count >= CUSTOMER_PATIENT_OTP_MAX_ATTEMPTS) return false;
    if (!verifyCustomerPatientOtp(challenge.id, code, challenge.code_hash, environment)) {
      await client.customer_patient_link_challenges.update({ where: { id: challenge.id }, data: { attempt_count: { increment: 1 } } });
      return false;
    }
    const account = await adultAccount(client, accountId);
    const dependant = await findAccountDependant(accountId, dependantId, client);
    if (!account || !dependant || isAdultBirthDate(dependant.birth_date) || account.email !== challenge.recipient_email) return false;
    const patient = await client.patients.findFirst({ where: { id: challenge.patient_id, ...representedPatientWhere(account, dependant) }, select: { id: true } });
    if (!patient || !await bindDependant(client, account, dependant, patient.id)) return false;
    await client.customer_patient_link_challenges.update({ where: { id: challenge.id }, data: { consumed_at: now } });
    await client.customer_accounts.update({ where: { id: accountId }, data: { email_verified_at: now } });
    return true;
  });
}
