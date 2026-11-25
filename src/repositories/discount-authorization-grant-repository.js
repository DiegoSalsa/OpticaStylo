import { PERMISSIONS } from "../auth/permissions.js";
import { prisma } from "../db/prisma.js";

function mapGrant(row) {
  if (!row) return null;
  return {
    amountCents: Number(row.amount_cents), authorizedBy: row.authorized_by,
    createdAt: row.created_at, expiresAt: row.expires_at, id: row.id, reason: row.reason,
  };
}

export async function createDiscountAuthorizationGrant(grant) {
  return mapGrant(await prisma.discount_authorization_grants.create({ data: {
    amount_cents: grant.amountCents, authorized_by: grant.authorizedBy,
    expires_at: grant.expiresAt, reason: grant.reason, requested_by: grant.requestedBy,
  } }));
}

export async function lockDiscountAuthorizationWithClient(client, { amountCents, authorizationId, reason, requestedBy, branchId }) {
  const row = await client.discount_authorization_grants.findFirst({
    select: { authorized_by: true },
    where: {
      amount_cents: amountCents, consumed_at: null, expires_at: { gt: new Date() },
      id: authorizationId, reason, requested_by: requestedBy,
    },
  });
  if (!row || !branchId) return null;
  const roles = "user_roles_user_roles_user_idTousers";
  const grants = (code) => ({ some: { roles: { role_permissions: { some: { permissions: { code } } } } } });
  const authorizer = await client.users.findFirst({
    where: { id: row.authorized_by, is_active: true, [roles]: grants(PERMISSIONS.SALES_DISCOUNTS_AUTHORIZE), OR: [
      { [roles]: grants(PERMISSIONS.BRANCHES_ACCESS_ALL) },
      { user_branches: { some: { branch_id: branchId, branches: { is_active: true } } } },
    ] },
    select: { id: true },
  });
  return authorizer?.id ?? null;
}

export async function consumeDiscountAuthorizationWithClient(client, authorizationId, saleId) {
  await client.discount_authorization_grants.update({
    data: { consumed_at: new Date(), sale_id: saleId }, where: { id: authorizationId },
  });
}
