import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con discount-authorization-grant-repository.

// Transformar map grant al formato utilizado por el resto de la aplicación
function mapGrant(row) {
  if (!row) return null;
  return {
    amountCents: Number(row.amount_cents), authorizedBy: row.authorized_by,
    createdAt: row.created_at, expiresAt: row.expires_at, id: row.id, reason: row.reason,
  };
}

// Crear o registrar create descuento authorization grant aplicando las reglas de negocio y persistencia correspondientes
export async function createDiscountAuthorizationGrant(grant) {
  return mapGrant(await prisma.discount_authorization_grants.create({ data: {
    amount_cents: grant.amountCents, authorized_by: grant.authorizedBy,
    expires_at: grant.expiresAt, reason: grant.reason, requested_by: grant.requestedBy,
  } }));
}

// Centralizar la lógica de lock descuento authorization with client para mantener consistente el comportamiento de la aplicación
export async function lockDiscountAuthorizationWithClient(client, { amountCents, authorizationId, reason, requestedBy }) {
  const row = await client.discount_authorization_grants.findFirst({
    select: { authorized_by: true },
    where: {
      amount_cents: amountCents, consumed_at: null, expires_at: { gt: new Date() },
      id: authorizationId, reason, requested_by: requestedBy,
    },
  });
  return row?.authorized_by ?? null;
}

// Centralizar la lógica de consume descuento authorization with client para mantener consistente el comportamiento de la aplicación
export async function consumeDiscountAuthorizationWithClient(client, authorizationId, saleId) {
  await client.discount_authorization_grants.update({
    data: { consumed_at: new Date(), sale_id: saleId }, where: { id: authorizationId },
  });
}
