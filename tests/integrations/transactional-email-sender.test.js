import assert from "node:assert/strict";
import test from "node:test";

import { sendTransactionalEmail } from "../../src/integrations/email/transactional-email-sender.js";

const email = {
  id: "00000000-0000-4000-8000-000000000001",
  payload: { amountCents: 49990, saleId: "sale-1", saleNumber: 42 },
  recipientEmail: "cliente@example.com",
  templateCode: "PAYMENT_CONFIRMED",
};

test("envía la confirmación real con una clave idempotente", async () => {
  const result = await sendTransactionalEmail(email, {
    apiKey: "re_test",
    from: "Optica Stylo <ventas@example.com>",
    fetch: async (_url, options) => {
      assert.equal(options.headers["Idempotency-Key"], `optica-stylo-outbox-${email.id}`);
      const body = JSON.parse(options.body);
      assert.deepEqual(body.to, [email.recipientEmail]);
      assert.match(body.subject, /Pago confirmado/);
      assert.match(body.html, /\$49\.990/);
      return { json: async () => ({ id: "email-provider-1" }), ok: true, status: 200 };
    },
  });
  assert.deepEqual(result, { providerId: "email-provider-1", status: "SENT" });
});

test("falla explícitamente si el proveedor de correo no está configurado", async () => {
  await assert.rejects(() => sendTransactionalEmail(email, {
    apiKey: "",
    from: "",
    fetch: async () => assert.fail("No debe llamar al proveedor"),
  }), /no esta configurado/);
});
