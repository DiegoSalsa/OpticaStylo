import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeDiscountAuthorizationWithClient,
  lockDiscountAuthorizationWithClient,
} from "../../src/repositories/discount-authorization-grant-repository.js";

const authorizationId = "00000000-0000-4000-8000-000000000001";
const requestedBy = "00000000-0000-4000-8000-000000000002";
const authorizedBy = "00000000-0000-4000-8000-000000000003";
const saleId = "00000000-0000-4000-8000-000000000004";

test("bloquea una autorización temporal de descuento antes de consumirla", async () => {
  let query;
  const client = {
    discount_authorization_grants: {
      async findFirst(options) {
        query = options;
        return { authorized_by: authorizedBy };
      },
    },
  };
  const result = await lockDiscountAuthorizationWithClient(client, {
    amountCents: 5000, authorizationId, reason: "Convenio de prueba", requestedBy,
  });
  assert.equal(result, authorizedBy);
  assert.deepEqual(query.where, {
    amount_cents: 5000, consumed_at: null, expires_at: { gt: query.where.expires_at.gt },
    id: authorizationId, reason: "Convenio de prueba", requested_by: requestedBy,
  });
  assert.ok(query.where.expires_at.gt instanceof Date);
});

test("asocia la autorización consumida a una única venta", async () => {
  let query;
  const client = {
    discount_authorization_grants: {
      async update(options) {
        query = options;
      },
    },
  };
  await consumeDiscountAuthorizationWithClient(client, authorizationId, saleId);
  assert.equal(query.where.id, authorizationId);
  assert.equal(query.data.sale_id, saleId);
  assert.ok(query.data.consumed_at instanceof Date);
});
