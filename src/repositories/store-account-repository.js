import { prisma } from "../db/prisma.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

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
  return prisma.$transaction(async (client) => {
    const customer = await client.customers.create({ data: {
      address: account.address, created_by: null, email: account.email,
      first_names: account.firstNames, last_names: account.lastNames,
      phone: account.phone, rut: account.rut, updated_by: null,
    } });
    const created = await client.customer_accounts.create({
      data: { customer_id: customer.id, email: account.email, password_hash: account.passwordHash },
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
  }, { isolationLevel: "Serializable" });
}

export async function createCustomerSession({ accountId, expiresAt, ipAddress, tokenHash, userAgent }) {
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
  return prisma.$transaction(async (client) => {
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
    await client.customer_account_sessions.update({ data: { last_used_at: now }, where: { id: session.id } });
    return { ...mapAccount(session.customer_accounts), expiresAt: session.expires_at, sessionId: session.id };
  });
}

export async function revokeCustomerSession(sessionId, accountId) {
  const result = await prisma.customer_account_sessions.updateMany({
    data: { revoked_at: new Date() },
    where: { account_id: accountId, id: sessionId, revoked_at: null },
  });
  if (result.count) return true;
  return (await prisma.customer_account_sessions.count({ where: { account_id: accountId, id: sessionId } })) > 0;
}
