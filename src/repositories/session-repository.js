import { prisma } from "../db/prisma.js";

export async function findActiveSessionByTokenHash(tokenHash) {
  return prisma.$transaction(async (client) => {
    const now = new Date();
    const session = await client.user_sessions.findFirst({
      include: {
        users: {
          include: {
            user_roles_user_roles_user_idTousers: {
              include: { roles: { include: { role_permissions: { include: { permissions: true } } } } },
            },
          },
        },
      },
      where: {
        expires_at: { gt: now }, revoked_at: null, token_hash: tokenHash,
        users: { is_active: true, OR: [{ locked_until: null }, { locked_until: { lte: now } }] },
      },
    });
    if (!session) return null;
    await client.user_sessions.update({ data: { last_used_at: now }, where: { id: session.id } });
    const roles = session.users.user_roles_user_roles_user_idTousers.map((item) => item.roles.code);
    const permissions = [...new Set(session.users.user_roles_user_roles_user_idTousers
      .flatMap((item) => item.roles.role_permissions.map((entry) => entry.permissions.code)))];
    return {
      email: session.users.email, expiresAt: session.expires_at, permissions, roles,
      sessionId: session.id, userId: session.user_id,
    };
  });
}

export async function createSessionForSuccessfulLogin({ expiresAt, ipAddress, tokenHash, userAgent, userId }) {
  return prisma.$transaction(async (client) => {
    await client.users.update({ data: {
      failed_login_attempts: 0, last_login_at: new Date(), locked_until: null,
    }, where: { id: userId } });
    const session = await client.user_sessions.create({ data: {
      created_ip: ipAddress, expires_at: expiresAt, token_hash: tokenHash,
      user_agent: userAgent, user_id: userId,
    } });
    return { expiresAt: session.expires_at, id: session.id };
  });
}

export async function revokeSession(sessionId, userId) {
  const result = await prisma.user_sessions.updateMany({
    data: { revoked_at: new Date() }, where: { id: sessionId, revoked_at: null, user_id: userId },
  });
  if (result.count) return true;
  return (await prisma.user_sessions.count({ where: { id: sessionId, user_id: userId } })) > 0;
}
