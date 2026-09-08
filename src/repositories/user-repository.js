import { prisma } from "../db/prisma.js";

const roleRelation = "user_roles_user_roles_user_idTousers";

function roleCodes(row) {
  return (row?.[roleRelation] ?? []).map((entry) => entry.roles.code).sort();
}

function mapUser(row) {
  if (!row) return null;
  return {
    createdAt: row.created_at, email: row.email, firstName: row.first_name,
    id: row.id, isActive: row.is_active, lastLoginAt: row.last_login_at,
    lastName: row.last_name, roles: roleCodes(row),
  };
}

const includeRoles = { [roleRelation]: { include: { roles: true } } };

async function findUserByIdWithClient(client, userId) {
  return mapUser(await client.users.findUnique({ include: includeRoles, where: { id: userId } }));
}

async function insertUserWithRoles(client, userData, assignedBy) {
  const roles = await client.roles.findMany({
    orderBy: { code: "asc" }, where: { code: { in: userData.roles } },
  });
  if (roles.length !== userData.roles.length) return null;
  const created = await client.users.create({
    data: {
      email: userData.email, first_name: userData.firstName,
      last_name: userData.lastName, password_hash: userData.passwordHash,
      [roleRelation]: {
        create: roles.map((role) => ({ assigned_by: assignedBy, role_id: role.id })),
      },
    },
    include: includeRoles,
  });
  return mapUser(created);
}

export async function createUserWithRoles(userData, assignedBy) {
  return prisma.$transaction((client) => insertUserWithRoles(client, userData, assignedBy));
}

export async function listUsers({ page, pageSize, search }) {
  const where = search ? { OR: [
    { email: { contains: search, mode: "insensitive" } },
    { first_name: { contains: search, mode: "insensitive" } },
    { last_name: { contains: search, mode: "insensitive" } },
  ] } : {};
  const [items, total] = await prisma.$transaction([
    prisma.users.findMany({
      include: includeRoles,
      orderBy: [{ is_active: "desc" }, { last_name: "asc" }, { first_name: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize, where,
    }),
    prisma.users.count({ where }),
  ]);
  return {
    items: items.map(mapUser), page, pageSize, total,
    totalPages: total ? Math.ceil(total / pageSize) : 0,
  };
}

export async function findUserById(userId) {
  return findUserByIdWithClient(prisma, userId);
}

export async function updateUserWithRoles(userId, userData, actorUserId) {
  return prisma.$transaction(async (client) => {
    const current = await findUserByIdWithClient(client, userId);
    if (!current) return { reason: "USER_NOT_FOUND", user: null };
    const removesActiveAdmin = current.isActive && current.roles.includes("ADMIN")
      && (!userData.isActive || !userData.roles.includes("ADMIN"));
    if (removesActiveAdmin) {
      const activeAdmins = await client.users.count({
        where: {
          is_active: true,
          [roleRelation]: { some: { roles: { code: "ADMIN" } } },
        },
      });
      if (activeAdmins <= 1) return { reason: "LAST_ACTIVE_ADMIN", user: null };
    }
    const roles = await client.roles.findMany({ where: { code: { in: userData.roles } } });
    if (roles.length !== userData.roles.length) return { reason: "INVALID_USER_ROLES", user: null };
    await client.users.update({
      data: {
        email: userData.email, first_name: userData.firstName,
        is_active: userData.isActive, last_name: userData.lastName,
        ...(userData.passwordHash ? {
          password_changed_at: new Date(), password_hash: userData.passwordHash,
        } : {}),
      },
      where: { id: userId },
    });
    await client.user_roles.deleteMany({ where: { user_id: userId } });
    await client.user_roles.createMany({
      data: roles.map((role) => ({ assigned_by: actorUserId, role_id: role.id, user_id: userId })),
    });
    if (userData.revokeSessions) {
      await client.user_sessions.updateMany({
        data: { revoked_at: new Date() }, where: { revoked_at: null, user_id: userId },
      });
    }
    return { reason: null, user: await findUserByIdWithClient(client, userId) };
  }, { isolationLevel: "Serializable" });
}

export async function createInitialAdmin(userData) {
  return prisma.$transaction(async (client) => {
    if (await client.users.count()) return null;
    return insertUserWithRoles(client, userData, null);
  }, { isolationLevel: "Serializable" });
}

export async function findUserForAuthentication(email) {
  const user = await prisma.users.findFirst({ include: includeRoles, where: { email } });
  if (!user) return null;
  return {
    email: user.email, failedLoginAttempts: user.failed_login_attempts,
    firstName: user.first_name, id: user.id, isActive: user.is_active,
    lastName: user.last_name, lockedUntil: user.locked_until,
    passwordHash: user.password_hash, roles: roleCodes(user),
  };
}

export async function findUserForPermissionAuthorization(email, permissionCode) {
  const user = await prisma.users.findFirst({
    where: {
      email,
      [roleRelation]: {
        some: { roles: { role_permissions: { some: { permissions: { code: permissionCode } } } } },
      },
    },
  });
  return user ? {
    email: user.email, firstName: user.first_name, id: user.id,
    isActive: user.is_active, lastName: user.last_name,
    lockedUntil: user.locked_until, passwordHash: user.password_hash,
  } : null;
}

export async function recordFailedLogin(userId, maximumAttempts, lockMinutes) {
  await prisma.$transaction(async (client) => {
    const user = await client.users.findUnique({ where: { id: userId } });
    if (!user) return;
    const now = new Date();
    const attempts = Math.min(
      user.locked_until && user.locked_until <= now ? 1 : user.failed_login_attempts + 1,
      maximumAttempts,
    );
    await client.users.update({
      data: {
        failed_login_attempts: attempts,
        locked_until: attempts >= maximumAttempts
          ? new Date(now.getTime() + lockMinutes * 60_000)
          : null,
      },
      where: { id: userId },
    });
  }, { isolationLevel: "Serializable" });
}
