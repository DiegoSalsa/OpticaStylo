import { Webhook } from "svix";

export function verifyResendWebhook(rawBody, headers, secret, dependencies = {}) {
  if (!secret) throw new Error("RESEND_WEBHOOK_SECRET no está configurado.");
  const signatureHeaders = {
    "svix-id": headers.get("svix-id") ?? "",
    "svix-signature": headers.get("svix-signature") ?? "",
    "svix-timestamp": headers.get("svix-timestamp") ?? "",
  };
  if (Object.values(signatureHeaders).some((value) => !value)) {
    throw new Error("Faltan encabezados de firma.");
  }
  const webhook = dependencies.webhook ?? new Webhook(secret);
  return webhook.verify(rawBody, signatureHeaders);
}

