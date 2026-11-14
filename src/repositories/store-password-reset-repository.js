import { prisma } from "../db/prisma.js";
import { commerceCodeHash, verifyCommerceCode } from "../utils/commerce-otp.js";

export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

async function lockAccount(client, id) {
  await client.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${id}::uuid FOR UPDATE`;
  return client.customer_accounts.findUnique({
    where: { id },
    select: { id: true, email: true, is_active: true },
  });
}

export async function queuePasswordReset({ challengeId, code, email, expiresAt }, database = prisma) {
  return database.$transaction(async (client) => {
    const match = await client.customer_accounts.findFirst({
      where: { email, is_active: true },
      select: { id: true },
    });
    if (!match) return null;
    const account = await lockAccount(client, match.id);
    if (!account?.is_active || account.email !== email) return null;
    const previous = await client.customer_password_resets.findUnique({
      where: { account_id: account.id },
      select: { expires_at: true },
    });
    if (previous?.expires_at > expiresAt || expiresAt <= new Date()) return null;

    const proof = {
      id: challengeId,
      email: account.email,
      code_hash: commerceCodeHash(`password-reset:${challengeId}`, code),
      expires_at: expiresAt,
      attempt_count: 0,
      consumed_at: null,
    };
    await client.customer_password_resets.upsert({
      where: { account_id: account.id },
      create: { account_id: account.id, ...proof },
      update: proof,
    });
    const outbox = await client.transactional_email_outbox.create({
      data: {
        account_id: account.id,
        deduplication_key: `CUSTOMER_PASSWORD_RESET:${challengeId}`,
        payload: { challengeId, code },
        recipient_email: account.email,
        template_code: "CUSTOMER_PASSWORD_RESET",
      },
      select: { id: true },
    });
    return outbox.id;
  });
}

export async function consumePasswordReset({ challengeId, code, makePasswordHash }, database = prisma) {
  return database.$transaction(async (client) => {
    const match = await client.customer_password_resets.findUnique({
      where: { id: challengeId },
      select: { account_id: true },
    });
    if (!match) return false;
    const account = await lockAccount(client, match.account_id);
    const proof = await client.customer_password_resets.findUnique({ where: { id: challengeId } });
    if (!account?.is_active || !proof || proof.email !== account.email || proof.consumed_at
      || proof.expires_at <= new Date() || proof.attempt_count >= PASSWORD_RESET_MAX_ATTEMPTS) return false;

    if (!verifyCommerceCode(`password-reset:${challengeId}`, code, proof.code_hash)) {
      await client.customer_password_resets.update({
        where: { id: challengeId },
        data: { attempt_count: { increment: 1 } },
      });
      return false;
    }

    const passwordHash = await makePasswordHash();
    const now = new Date();
    await client.customer_password_resets.update({
      where: { id: challengeId },
      data: { consumed_at: now },
    });
    await client.customer_accounts.update({
      where: { id: account.id },
      data: { password_hash: passwordHash, password_changed_at: now, failed_login_attempts: 0, locked_until: null },
    });
    await client.customer_account_sessions.updateMany({
      where: { account_id: account.id, revoked_at: null },
      data: { revoked_at: now },
    });
    return true;
  });
}
