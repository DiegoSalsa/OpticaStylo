import assert from "node:assert/strict";
import test from "node:test";

import { deliverTransactionalEmail } from "../../src/services/transactional-email-service.js";

const email = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000001",
  status: "SENDING",
};

test("marca como enviado solo después de la aceptación del proveedor", async () => {
  let marked = false;
  const result = await deliverTransactionalEmail("payment:1", {
    claimEmail: async () => ({ claimed: true, email, reason: null }),
    markSent: async (id) => { assert.equal(id, email.id); marked = true; },
    sendEmail: async () => ({ providerId: "provider-1", status: "SENT" }),
  });
  assert.equal(marked, true);
  assert.equal(result.status, "SENT");
});

test("conserva el correo para reintento cuando falla el proveedor", async () => {
  let failure = null;
  const result = await deliverTransactionalEmail("payment:1", {
    claimEmail: async () => ({ claimed: true, email, reason: null }),
    markFailed: async (id, message) => { failure = { id, message }; },
    sendEmail: async () => { throw new Error("timeout"); },
  });
  assert.equal(failure.id, email.id);
  assert.equal(failure.message, "timeout");
  assert.equal(result.status, "FAILED");
});

test("no vuelve a enviar un correo ya confirmado", async () => {
  const result = await deliverTransactionalEmail("payment:1", {
    claimEmail: async () => ({ claimed: false, email: { status: "SENT" }, reason: "ALREADY_SENT" }),
    sendEmail: async () => assert.fail("No debe duplicar el envío"),
  });
  assert.equal(result.status, "SENT");
});
