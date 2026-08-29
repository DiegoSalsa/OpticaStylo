import assert from "node:assert/strict";
import test from "node:test";

import { getTransactionalEmailEligibility } from "../../src/repositories/transactional-email-repository.js";

const email = {
  passwordResetRequestId: "00000000-0000-4000-8000-000000000051",
  payload: { scope: "INTERNAL_USER" },
  templateCode: "PASSWORD_RECOVERY",
};

async function eligibility(row) {
  let parameters;
  const result = await getTransactionalEmailEligibility(email, {
    executeQuery: async (_sql, input) => {
      parameters = input;
      return { rows: row ? [row] : [] };
    },
  });
  return { parameters, result };
}

test("permite enviar solo una recuperación vigente", async () => {
  const { parameters, result } = await eligibility({
    consumed_at: null,
    is_current: true,
    revoked_at: null,
  });
  assert.deepEqual(parameters, [email.passwordResetRequestId, "INTERNAL_USER"]);
  assert.deepEqual(result, { eligible: true, reason: null });
});

for (const [state, row, reason] of [
  ["vencida", { consumed_at: null, is_current: false, revoked_at: null }, "PASSWORD_RECOVERY_EXPIRED"],
  ["revocada", { consumed_at: null, is_current: true, revoked_at: new Date() }, "PASSWORD_RECOVERY_REVOKED"],
  ["consumida", { consumed_at: new Date(), is_current: true, revoked_at: null }, "PASSWORD_RECOVERY_CONSUMED"],
  ["inexistente", null, "PASSWORD_RECOVERY_NOT_FOUND"],
]) {
  test(`suprime una recuperación ${state}`, async () => {
    assert.deepEqual((await eligibility(row)).result, { eligible: false, reason });
  });
}

test("suprime referencias sin un ámbito permitido sin consultar", async () => {
  let queried = false;
  const result = await getTransactionalEmailEligibility(
    { ...email, payload: { scope: "OTRO" } },
    { executeQuery: async () => { queried = true; } },
  );
  assert.equal(queried, false);
  assert.deepEqual(result, {
    eligible: false,
    reason: "PASSWORD_RECOVERY_INVALID_REFERENCE",
  });
});
