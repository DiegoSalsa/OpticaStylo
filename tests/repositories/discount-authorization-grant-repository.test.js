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
  const queries = [];
  const client = {
    query: async (query, parameters) => {
      queries.push({ parameters, query });
      return { rows: [{ authorized_by: authorizedBy }] };
    },
  };
  const result = await lockDiscountAuthorizationWithClient(client, {
    amountCents: 5000,
    authorizationId,
    reason: "Convenio de prueba",
    requestedBy,
  });

  assert.equal(result, authorizedBy);
  assert.deepEqual(queries[0].parameters, [
    authorizationId,
    requestedBy,
    5000,
    "Convenio de prueba",
  ]);
  assert.match(queries[0].query, /consumed_at IS NULL/);
  assert.match(queries[0].query, /expires_at > CURRENT_TIMESTAMP/);
  assert.match(queries[0].query, /FOR UPDATE/);
});

test("asocia la autorización consumida a una única venta", async () => {
  const queries = [];
  const client = {
    query: async (query, parameters) => {
      queries.push({ parameters, query });
      return { rows: [] };
    },
  };

  await consumeDiscountAuthorizationWithClient(client, authorizationId, saleId);

  assert.deepEqual(queries[0].parameters, [authorizationId, saleId]);
  assert.match(queries[0].query, /SET consumed_at = CURRENT_TIMESTAMP, sale_id = \$2/);
});
