import { prisma } from "../db/prisma.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";
import {findCustomerByNormalizedRut} from "./customer-identity.js";
import {consumeRegistrationProof} from "./customer-commerce-link-repository.js";
import {commercialError} from "../validations/customer-commercial-validation.js";
import {retryTransaction} from "../db/retry-transaction.js";
import { isAdultBirthDate } from "../utils/customer-account-age.js";

function mapAccount(row) {
  if (!row) return null;
  const customer = row.customers ?? row;
  const patientBirthDate = customer.patients?.birth_date;
  const birthDate = patientBirthDate && !isAdultBirthDate(patientBirthDate) ? patientBirthDate : row.birth_date ?? patientBirthDate;
  return {
    address: customer.address, customerId: row.customer_id, email: row.email,
    failedLoginAttempts: row.failed_login_attempts, firstNames: customer.first_names,
    id: row.id, isActive: row.is_active, lastNames: customer.last_names,
    lockedUntil: row.locked_until, passwordHash: row.password_hash,
    phone: customer.phone, rut: customer.rut,
    birthDate: birthDate?.toISOString().slice(0, 10) ?? null,
    emailVerified: Boolean(row.email_verified_at),
  };
}

export async function createCustomerAccount(account) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return retryTransaction(prisma,async (client) => {
    const patient = await client.patients.findUnique({ where: { rut: account.rut }, select: { birth_date: true } });
    if (patient && !isAdultBirthDate(patient.birth_date)) commercialError("El registro debe gestionarse desde la cuenta de un adulto responsable.", "ADULT_ACCOUNT_REQUIRED", 400);
    const existing=await findCustomerByNormalizedRut(client,account.rut,{lock:true});
    const verified=existing&&account.verification?await consumeRegistrationProof(client,account.verification,account):null;
    if(existing&&!verified)commercialError("Este RUT requiere verificar el correo registrado antes de crear la cuenta.","CUSTOMER_ACCOUNT_REQUIRES_LINKING",409);
    const customer = verified??await client.customers.create({ data: {
      address: account.address, created_by: null, email: account.email,
      first_names: account.firstNames, last_names: account.lastNames,
      phone: account.phone, rut: account.rut, updated_by: null,
    } });
    const created = await client.customer_accounts.create({
      data: { customer_id: customer.id, birth_date: new Date(account.birthDate + "T00:00:00.000Z"), email: account.email, password_hash: account.passwordHash,email_verified_at:verified?new Date():null,clinical_link_recheck_required:!!verified?.patient_id },
      include: { customers: true },
    });
    await client.transactional_email_outbox.upsert({
      create: {
        account_id: created.id,
        deduplication_key: transactionalEmailDeduplicationKey("ACCOUNT_CREATED", created.id),
        payload: { firstNames: account.firstNames },
        recipient_email: account.email,
        template_code: "ACCOUNT_CREATED",
      },
      update: {},
      where: { deduplication_key: transactionalEmailDeduplicationKey("ACCOUNT_CREATED", created.id) },
    });
    return mapAccount(created);
  });
}

export async function updateCustomerAccountContact(account, values) {
  return prisma.$transaction(async (client) => {
    const changed = await client.customers.updateMany({
      where: { id: account.customerId, customer_accounts: { id: account.id, is_active: true } },
      data: { ...values, record_version: { increment: 1 }, updated_by: null },
    });
    if (!changed.count) return null;
    return mapAccount(await client.customer_accounts.findUnique({ where: { id: account.id }, include: { customers: { include: { patients: { select: { birth_date: true } } } } } }));
  });
}

export async function confirmCustomerAccountBirthDate(accountId, birthDate) {
  return retryTransaction(prisma, async (client) => {
    const account = await client.customer_accounts.findUnique({
      where: { id: accountId, is_active: true }, include: { customers: { include: { patients: { select: { birth_date: true } } } } },
    });
    if (!account) return null;
    const known = account.birth_date ?? account.customers.patients?.birth_date;
    if (known && known.toISOString().slice(0, 10) !== birthDate) commercialError("La fecha no coincide con los datos del titular. Contacta a la óptica para corregirla.", "ACCOUNT_BIRTH_DATE_CONFLICT", 409);
    return mapAccount(await client.customer_accounts.update({
      where: { id: accountId }, data: { birth_date: new Date(birthDate + "T00:00:00.000Z") }, include: { customers: true },
    }));
  });
}

export async function findCustomerAccountForAuthentication(email) {
  return mapAccount(await prisma.customer_accounts.findFirst({
    include: { customers: { include: { patients: { select: { birth_date: true } } } } }, where: { email },
  }));
}

export async function recordCustomerFailedLogin(accountId, maximumAttempts, lockMinutes) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  await prisma.$transaction(async (client) => {
    const account = await client.customer_accounts.findUnique({ where: { id: accountId } });
    if (!account) return;
    const attempts = Math.min(account.failed_login_attempts + 1, maximumAttempts);
    await client.customer_accounts.update({
      data: {
        failed_login_attempts: attempts,
        locked_until: attempts >= maximumAttempts
          ? new Date(Date.now() + lockMinutes * 60_000)
          : account.locked_until,
      },
      where: { id: accountId },
    });
  // Usar aislamiento serializable para reducir conflictos entre operaciones concurrentes
  }, { isolationLevel: "Serializable" });
}

export async function createCustomerSession({ accountId, expiresAt, ipAddress, passwordHash, tokenHash, userAgent }) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    const result = await client.customer_accounts.updateMany({
      data: { failed_login_attempts: 0, last_login_at: new Date(), locked_until: null },
      where: { id: accountId, is_active: true, password_hash: passwordHash },
    });
    if (!result.count) return null;
    const session = await client.customer_account_sessions.create({ data: {
      account_id: accountId, created_ip: ipAddress, expires_at: expiresAt,
      token_hash: tokenHash, user_agent: userAgent,
    } });
    return { expiresAt: session.expires_at, id: session.id };
  });
}

export async function findActiveCustomerSession(tokenHash) {
  const client = prisma;
  const now = new Date();
  const session = await client.customer_account_sessions.findFirst({
    include: { customer_accounts: { include: { customers: { include: { patients: { select: { birth_date: true } } } } } } },
    where: {
      expires_at: { gt: now }, revoked_at: null, token_hash: tokenHash,
      customer_accounts: {
        is_active: true, OR: [{ locked_until: null }, { locked_until: { lte: now } }],
      },
    },
  });
  if (!session) return null;
  const account = mapAccount(session.customer_accounts);
  if (account.birthDate && !isAdultBirthDate(account.birthDate)) return null;
  const activityThreshold = new Date(now.getTime() - 60_000);
  if (session.last_used_at < activityThreshold) {
    await client.customer_account_sessions.updateMany({
      data: { last_used_at: now }, where: { id: session.id, revoked_at: null, last_used_at: { lt: activityThreshold } },
    });
  }
  return { ...account, expiresAt: session.expires_at, sessionId: session.id };
}

export async function revokeCustomerSession(sessionId, accountId) {
  const result = await prisma.customer_account_sessions.updateMany({
    data: { revoked_at: new Date() },
    where: { account_id: accountId, id: sessionId, revoked_at: null },
  });
  if (result.count) return true;
  return (await prisma.customer_account_sessions.count({ where: { account_id: accountId, id: sessionId } })) > 0;
}
