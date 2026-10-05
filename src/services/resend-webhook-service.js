import { createHash } from "node:crypto";

import { verifyResendWebhook } from "../integrations/email/resend-webhook.js";
import { recordTransactionalEmailProviderEvent } from "../repositories/transactional-email-repository.js";
import { AppError } from "../utils/app-error.js";

function sanitizedEventData(payload) {
  const bounce = payload?.data?.bounce;
  if (!bounce || typeof bounce !== "object") return {};
  return {
    bounceSubType: typeof bounce.subType === "string" ? bounce.subType.slice(0, 80) : null,
    bounceType: typeof bounce.type === "string" ? bounce.type.slice(0, 80) : null,
  };
}

export async function processResendWebhook(rawBody, headers, dependencies = {}) {
  const secret = dependencies.secret ?? process.env.RESEND_WEBHOOK_SECRET;
  let payload;
  try {
    payload = (dependencies.verify ?? verifyResendWebhook)(
      rawBody,
      headers,
      secret,
      dependencies.verificationDependencies,
    );
  } catch (error) {
    throw new AppError({
      cause: error,
      code: "INVALID_EMAIL_WEBHOOK_SIGNATURE",
      message: "La firma del webhook no es válida.",
      status: 400,
    });
  }
  const providerEventId = headers.get("svix-id");
  const providerMessageId = payload?.data?.email_id;
  if (
    !payload
    || typeof payload.type !== "string"
    || typeof providerEventId !== "string"
    || (payload.type.startsWith("email.") && typeof providerMessageId !== "string")
  ) {
    throw new AppError({
      code: "INVALID_EMAIL_WEBHOOK_PAYLOAD",
      message: "El webhook no tiene el formato esperado.",
      status: 400,
    });
  }
  const occurredAt = new Date(payload.created_at);
  const result = await (
    dependencies.recordEvent ?? recordTransactionalEmailProviderEvent
  )({
    eventData: sanitizedEventData(payload),
    eventType: payload.type.slice(0, 80),
    occurredAt: Number.isNaN(occurredAt.getTime()) ? null : occurredAt,
    payloadSha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
    provider: "RESEND",
    providerEventId: providerEventId.slice(0, 200),
    providerMessageId: providerMessageId?.slice(0, 200) ?? null,
  });
  return { duplicate: result.duplicate };
}

