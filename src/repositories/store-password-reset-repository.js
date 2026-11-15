import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/app-error.js";
import { verifyCommerceCode } from "../utils/commerce-otp.js";

export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

async function lockAccount(client, id) {
  await client.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${id}::uuid FOR UPDATE`;
  return client.customer_accounts.findUnique({
    where: { id },
    select: { id: true, email: true, is_active: true },
  });
}

export async function assertPasswordResetStorageReady(client) {
  // Comprobar la forma sin leer filas. La misma transacción conserva los bloqueos de esquema.
  const [storage] = await client.$queryRaw`
    WITH shape AS (
      SELECT proof.id, proof.account_id, proof.email, proof.code_hash, proof.attempt_count,
             proof.expires_at, proof.consumed_at, mail.id AS mail_id, mail.account_id AS mail_account,
             mail.payload, mail.template_code, mail.recipient_email, mail.deduplication_key
      FROM customer_password_resets AS proof CROSS JOIN transactional_email_outbox AS mail
      WHERE FALSE
    )
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'transactional_email_outbox'::regclass
        AND conname = 'transactional_email_template'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%CUSTOMER_PASSWORD_RESET%'
    ) AND NOT EXISTS (SELECT 1 FROM shape)
      AND has_table_privilege('customer_password_resets', 'INSERT')
      AND has_table_privilege('customer_password_resets', 'UPDATE')
      AND has_table_privilege('transactional_email_outbox', 'INSERT') AS ready`;
  if (!storage?.ready) throw new AppError({ code: "PASSWORD_RESET_STORAGE_NOT_READY" });
}

export async function queuePasswordReset({ challengeId, protectCode, email, expiresAt }, client) {
  const match = await client.customer_accounts.findFirst({
    where: { email, is_active: true },
    select: { id: true },
  });
  if (!match) return null;
  const account = await lockAccount(client, match.id);
  if (!account?.is_active || account.email !== email) return null;
  const previous = await client.customer_password_resets.findUnique({
    where: { account_id: account.id },
    select: { id: true, code_hash: true },
  });
  const { codeHash, encryptedCode } = protectCode(previous);
  const proof = {
    id: challengeId,
    email: account.email,
    code_hash: codeHash,
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
      payload: { challengeId, encryptedCode },
      recipient_email: account.email,
      template_code: "CUSTOMER_PASSWORD_RESET",
    },
    select: { id: true },
  });
  return outbox.id;
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
      data: { password_hash: passwordHash, password_changed_at: now, email_verified_at: now, failed_login_attempts: 0, locked_until: null },
    });
    await client.customer_account_sessions.updateMany({
      where: { account_id: account.id, revoked_at: null },
      data: { revoked_at: now },
    });
    return true;
  });
}
