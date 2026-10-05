const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const RECOVERABLE_STATUS_CODES = new Set([408, 409, 425, 429]);
const RECOVERABLE_ERROR_CODES = new Set([
  "application_error",
  "concurrent_idempotent_requests",
  "daily_quota_exceeded",
  "internal_server_error",
  "monthly_quota_exceeded",
  "rate_limit_exceeded",
  "timeout",
]);

function safeErrorCode(value, fallback) {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 80)
    : "";
  return normalized || fallback;
}

function retryAfter(response) {
  const value = Number(response.headers?.get?.("retry-after"));
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.ceil(value), 86_400) : null;
}

export class EmailProviderError extends Error {
  constructor({ code, retryAfterSeconds = null, retryable, statusCode = null }) {
    super(retryable
      ? "El proveedor de correo no está disponible temporalmente."
      : "El proveedor rechazó permanentemente el mensaje.");
    this.code = code;
    this.name = "EmailProviderError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

export function createResendEmailProvider(config, dependencies = {}) {
  const fetcher = dependencies.fetch ?? fetch;
  return {
    name: "RESEND",
    async send({ email, rendered, recipient }) {
      let response;
      try {
        response = await fetcher(RESEND_EMAIL_ENDPOINT, {
          body: JSON.stringify({
            from: config.from,
            html: rendered.html,
            subject: rendered.subject,
            text: rendered.text,
            to: [recipient],
          }),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `stylo_${email.id}_${rendered.version}`,
            "User-Agent": "OpticaStylo-TransactionalEmail/1.0",
          },
          method: "POST",
          signal: dependencies.signal ?? AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
        throw new EmailProviderError({
          code: timedOut ? "timeout" : "network_error",
          retryable: true,
        });
      }

      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.id === "string" && payload.id.length <= 200) {
        return { provider: "RESEND", providerMessageId: payload.id };
      }

      const code = safeErrorCode(
        payload.name ?? payload.type ?? payload.error?.name,
        `http_${response.status}`,
      );
      const retryable = response.status >= 500
        || RECOVERABLE_STATUS_CODES.has(response.status)
        || RECOVERABLE_ERROR_CODES.has(code);
      throw new EmailProviderError({
        code,
        retryAfterSeconds: retryAfter(response),
        retryable,
        statusCode: response.status,
      });
    },
  };
}

