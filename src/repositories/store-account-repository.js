import { prisma } from "../db/prisma.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";
import {findCustomerByNormalizedRut} from "./customer-identity.js";
import {consumeRegistrationProof} from "./customer-commerce-link-repository.js";
import {commercialError} from "../validations/customer-commercial-validation.js";
import {retryTransaction} from "../db/retry-transaction.js";

function mapAccount(row) {
  if (!row) return null;
  const customer = row.customers ?? row;
  return {
    address: customer.address, customerId: row.customer_id, email: row.email,
    failedLoginAttempts: row.failed_login_attempts, firstNames: customer.first_names,
    id: row.id, isActive: row.is_active, lastNames: customer.last_names,
    lockedUntil: row.locked_until, passwordHash: row.password_hash,
    phone: customer.phone, rut: customer.rut,
  };
}

export async function createCustomerAccount(account) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return retryTransaction(prisma,async (client) => {
    const existing=await findCustomerByNormalizedRut(client,account.rut,{lock:true});
    const verified=existing&&account.verification?await consumeRegistrationProof(client,account.verification,account):null;
    if(existing&&!verified)commercialError("Este RUT requiere verificar el correo registrado antes de crear la cuenta.","CUSTOMER_ACCOUNT_REQUIRES_LINKING",409);
    const customer = verified??await client.customers.create({ data: {
      address: account.address, created_by: null, email: account.email,
      first_names: account.firstNames, last_names: account.lastNames,
      phone: account.phone, rut: account.rut, updated_by: null,
    } });
    const created = await client.customer_accounts.create({
      data: { customer_id: customer.id, email: account.email, password_hash: account.passwordHash,email_verified_at:verified?new Date():null,clinical_link_recheck_required:!!verified?.patient_id },
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

export async function findCustomerAccountForAuthentication(email) {
  return mapAccount(await prisma.customer_accounts.findFirst({
    include: { customers: true }, where: { email },
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

export async function createCustomerSession({ accountId, expiresAt, ipAddress, tokenHash, userAgent }) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    await client.customer_accounts.update({
      data: { failed_login_attempts: 0, last_login_at: new Date(), locked_until: null },
      where: { id: accountId },
    });
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
    include: { customer_accounts: { include: { customers: true } } },
    where: {
      expires_at: { gt: now }, revoked_at: null, token_hash: tokenHash,
      customer_accounts: {
        is_active: true, OR: [{ locked_until: null }, { locked_until: { lte: now } }],
      },
    },
  });
  if (!session) return null;
  const activityThreshold = new Date(now.getTime() - 60_000);
  if (session.last_used_at < activityThreshold) {
    await client.customer_account_sessions.updateMany({
      data: { last_used_at: now }, where: { id: session.id, revoked_at: null, last_used_at: { lt: activityThreshold } },
    });
  }
  return { ...mapAccount(session.customer_accounts), expiresAt: session.expires_at, sessionId: session.id };
}

export async function revokeCustomerSession(sessionId, accountId) {
  const result = await prisma.customer_account_sessions.updateMany({
    data: { revoked_at: new Date() },
    where: { account_id: accountId, id: sessionId, revoked_at: null },
  });
  if (result.count) return true;
  return (await prisma.customer_account_sessions.count({ where: { account_id: accountId, id: sessionId } })) > 0;
}
