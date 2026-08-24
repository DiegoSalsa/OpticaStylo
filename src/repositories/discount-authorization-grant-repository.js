import { executeQuery } from "../db/query.js";

function mapGrant(row) {
  if (!row) return null;
  return {
    amountCents: Number(row.amount_cents),
    authorizedBy: row.authorized_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    reason: row.reason,
  };
}

export async function createDiscountAuthorizationGrant(grant) {
  const result = await executeQuery(
    `INSERT INTO discount_authorization_grants (
       requested_by, authorized_by, amount_cents, reason, expires_at
     ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      grant.requestedBy,
      grant.authorizedBy,
      grant.amountCents,
      grant.reason,
      grant.expiresAt,
    ],
  );
  return mapGrant(result.rows[0]);
}

export async function lockDiscountAuthorizationWithClient(
  client,
  { amountCents, authorizationId, reason, requestedBy },
) {
  const result = await client.query(
    `SELECT authorized_by
     FROM discount_authorization_grants
     WHERE id = $1
       AND requested_by = $2
       AND amount_cents = $3
       AND reason = $4
       AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
     FOR UPDATE`,
    [authorizationId, requestedBy, amountCents, reason],
  );
  return result.rows[0]?.authorized_by ?? null;
}

export async function consumeDiscountAuthorizationWithClient(
  client,
  authorizationId,
  saleId,
) {
  await client.query(
    `UPDATE discount_authorization_grants
     SET consumed_at = CURRENT_TIMESTAMP, sale_id = $2
     WHERE id = $1`,
    [authorizationId, saleId],
  );
}
