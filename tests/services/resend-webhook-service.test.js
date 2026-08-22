import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { Webhook } from "svix";

import { processResendWebhook } from "../../src/services/resend-webhook-service.js";

function signedRequest(overrides = {}) {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const id = overrides.id ?? "msg_webhook_test_1";
  const date = new Date();
  const payload = JSON.stringify(overrides.payload ?? {
    created_at: date.toISOString(),
    data: { email_id: "provider-message-1", to: ["oculto@example.com"] },
    type: "email.delivered",
  });
  const webhook = new Webhook(secret);
  const signature = webhook.sign(id, date, payload);
  return {
    headers: new Headers({
      "svix-id": id,
      "svix-signature": signature,
      "svix-timestamp": String(Math.floor(date.getTime() / 1_000)),
    }),
    payload,
    secret,
  };
}

test("acepta un webhook válido y no conserva el destinatario", async () => {
  const request = signedRequest();
  let recorded;
  await processResendWebhook(request.payload, request.headers, {
    recordEvent: async (event) => { recorded = event; return { duplicate: false }; },
    secret: request.secret,
  });
  assert.equal(recorded.eventType, "email.delivered");
  assert.equal(recorded.providerMessageId, "provider-message-1");
  assert.deepEqual(recorded.eventData, {});
  assert.equal(JSON.stringify(recorded).includes("oculto@example.com"), false);
});

test("rechaza una firma incorrecta antes de registrar", async () => {
  const request = signedRequest();
  request.headers.set("svix-signature", "v1,firma-invalida");
  await assert.rejects(
    () => processResendWebhook(request.payload, request.headers, {
      recordEvent: async () => assert.fail("No debe registrar"),
      secret: request.secret,
    }),
    (error) => error.code === "INVALID_EMAIL_WEBHOOK_SIGNATURE" && error.status === 400,
  );
});

test("un webhook repetido conserva la idempotencia del repositorio", async () => {
  const request = signedRequest({ id: "msg_webhook_repeated" });
  const seen = new Set();
  const recordEvent = async (event) => {
    const duplicate = seen.has(event.providerEventId);
    seen.add(event.providerEventId);
    return { duplicate };
  };
  assert.deepEqual(
    await processResendWebhook(request.payload, request.headers, { recordEvent, secret: request.secret }),
    { duplicate: false },
  );
  assert.deepEqual(
    await processResendWebhook(request.payload, request.headers, { recordEvent, secret: request.secret }),
    { duplicate: true },
  );
});

