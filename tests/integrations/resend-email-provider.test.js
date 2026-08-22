import assert from "node:assert/strict";
import test from "node:test";

import {
  EmailProviderError,
  createResendEmailProvider,
} from "../../src/integrations/email/resend-email-provider.js";

const config = {
  apiKey: "clave-de-prueba-no-real",
  from: "Stylo Vivo <onboarding@resend.dev>",
  timeoutMs: 1_000,
};
const request = {
  email: { id: "00000000-0000-4000-8000-000000000001" },
  recipient: "pruebas@example.com",
  rendered: { html: "<p>Seguro</p>", subject: "Prueba", text: "Seguro", version: "v1" },
};

test("envía texto y HTML con clave de idempotencia estable", async () => {
  let captured;
  const provider = createResendEmailProvider(config, {
    fetch: async (url, options) => {
      captured = { options, url };
      return new Response(JSON.stringify({ id: "mensaje-proveedor-1" }), { status: 200 });
    },
  });
  assert.deepEqual(await provider.send(request), {
    provider: "RESEND",
    providerMessageId: "mensaje-proveedor-1",
  });
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.options.headers["Idempotency-Key"],
    `stylo_${request.email.id}_${request.rendered.version}`);
  const body = JSON.parse(captured.options.body);
  assert.equal(body.to[0], request.recipient);
  assert.equal(body.text, "Seguro");
  assert.equal(captured.options.headers.Authorization.includes(config.apiKey), true);
});

test("clasifica rate limit como error temporal y respeta retry-after", async () => {
  const provider = createResendEmailProvider(config, {
    fetch: async () => new Response(
      JSON.stringify({ name: "rate_limit_exceeded" }),
      { headers: { "retry-after": "17" }, status: 429 },
    ),
  });
  await assert.rejects(
    () => provider.send(request),
    (error) => error instanceof EmailProviderError
      && error.retryable
      && error.retryAfterSeconds === 17
      && error.code === "rate_limit_exceeded",
  );
});

test("clasifica validación como error permanente", async () => {
  const provider = createResendEmailProvider(config, {
    fetch: async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 400 }),
  });
  await assert.rejects(
    () => provider.send(request),
    (error) => error instanceof EmailProviderError
      && !error.retryable
      && error.code === "validation_error",
  );
});

test("clasifica timeout de red como recuperable", async () => {
  const provider = createResendEmailProvider(config, {
    fetch: async () => {
      const error = new Error("incluye información que no debe persistirse");
      error.name = "TimeoutError";
      throw error;
    },
  });
  await assert.rejects(
    () => provider.send(request),
    (error) => error.retryable && error.code === "timeout"
      && !error.message.includes("información"),
  );
});

