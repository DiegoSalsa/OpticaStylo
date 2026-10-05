const MODES = Object.freeze(["disabled", "simulate", "test", "live"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "EmailConfigurationError";
  }
}

export function getAppointmentReminderHours(environment = process.env) {
  return integer(environment, "EMAIL_APPOINTMENT_REMINDER_HOURS", 24, 1, 168);
}

function integer(environment, name, fallback, minimum, maximum) {
  const raw = environment[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new EmailConfigurationError(
      "INVALID_EMAIL_CONFIGURATION",
      `${name} debe ser un entero entre ${minimum} y ${maximum}.`,
    );
  }
  return value;
}

function normalizedEmail(value, name) {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new EmailConfigurationError(
      "INVALID_EMAIL_CONFIGURATION",
      `${name} debe contener un correo válido.`,
    );
  }
  return email;
}

function requireValue(value, name) {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new EmailConfigurationError(
      "INCOMPLETE_EMAIL_CONFIGURATION",
      `Falta configurar ${name}.`,
    );
  }
  return normalized;
}

export function getTransactionalEmailConfig(environment = process.env) {
  const mode = (environment.EMAIL_MODE ?? "disabled").trim().toLowerCase();
  if (!MODES.includes(mode)) {
    throw new EmailConfigurationError(
      "INVALID_EMAIL_MODE",
      `EMAIL_MODE debe ser uno de: ${MODES.join(", ")}.`,
    );
  }
  if (environment.NODE_ENV === "production" && mode === "simulate") {
    throw new EmailConfigurationError(
      "SIMULATION_FORBIDDEN_IN_PRODUCTION",
      "El modo simulate no está permitido en producción.",
    );
  }

  const timeoutMs = integer(environment, "EMAIL_PROVIDER_TIMEOUT_MS", 8_000, 1_000, 30_000);
  const lockSeconds = integer(environment, "EMAIL_LOCK_SECONDS", 60, 30, 900);
  if (lockSeconds * 1_000 <= timeoutMs + 10_000) {
    throw new EmailConfigurationError(
      "INVALID_EMAIL_LOCK_DURATION",
      "EMAIL_LOCK_SECONDS debe superar el timeout del proveedor por al menos 10 segundos.",
    );
  }

  const config = {
    apiKey: environment.RESEND_API_KEY?.trim() || null,
    appointmentReminderHours: getAppointmentReminderHours(environment),
    batchSize: integer(environment, "EMAIL_BATCH_SIZE", 20, 1, 100),
    domainVerified: environment.EMAIL_DOMAIN_VERIFIED === "true",
    from: environment.EMAIL_FROM?.trim() || null,
    lockSeconds,
    maxAttempts: integer(environment, "EMAIL_MAX_ATTEMPTS", 6, 1, 20),
    maxRetrySeconds: integer(environment, "EMAIL_RETRY_MAX_SECONDS", 3_600, 60, 86_400),
    mode,
    provider: "RESEND",
    retryBaseSeconds: integer(environment, "EMAIL_RETRY_BASE_SECONDS", 30, 5, 3_600),
    testRecipient: environment.EMAIL_TEST_RECIPIENT?.trim().toLowerCase() || null,
    timeZone: environment.APP_TIME_ZONE?.trim() || "America/Santiago",
    timeoutMs,
    webhookConfigured: Boolean(environment.RESEND_WEBHOOK_SECRET?.trim()),
    workerConfigured: Boolean(environment.CRON_SECRET?.trim()),
  };

  if (config.timeZone !== "America/Santiago") {
    throw new EmailConfigurationError(
      "INVALID_EMAIL_TIME_ZONE",
      "Los correos transaccionales requieren APP_TIME_ZONE=America/Santiago.",
    );
  }
  if (mode === "test") {
    config.apiKey = requireValue(config.apiKey, "RESEND_API_KEY");
    config.from = requireValue(config.from, "EMAIL_FROM");
    config.testRecipient = normalizedEmail(config.testRecipient, "EMAIL_TEST_RECIPIENT");
  }
  if (mode === "live") {
    config.apiKey = requireValue(config.apiKey, "RESEND_API_KEY");
    config.from = requireValue(config.from, "EMAIL_FROM");
    if (!config.domainVerified) {
      throw new EmailConfigurationError(
        "EMAIL_DOMAIN_NOT_VERIFIED",
        "El modo live exige EMAIL_DOMAIN_VERIFIED=true.",
      );
    }
  }
  return config;
}

export function getTransactionalEmailDiagnostic(environment = process.env) {
  try {
    const config = getTransactionalEmailConfig(environment);
    return {
      domainVerified: config.domainVerified,
      mode: config.mode,
      provider: config.provider,
      ready: true,
      testRecipientConfigured: Boolean(config.testRecipient),
      webhookConfigured: config.webhookConfigured,
      workerConfigured: config.workerConfigured,
    };
  } catch (error) {
    return {
      code: error instanceof EmailConfigurationError
        ? error.code
        : "INVALID_EMAIL_CONFIGURATION",
      mode: environment.EMAIL_MODE ?? "disabled",
      provider: "RESEND",
      ready: false,
    };
  }
}
