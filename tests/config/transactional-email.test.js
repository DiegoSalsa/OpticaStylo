import assert from "node:assert/strict";
import test from "node:test";

import {
  EmailConfigurationError,
  getTransactionalEmailConfig,
  getTransactionalEmailDiagnostic,
} from "../../src/config/transactional-email.js";

const base = { APP_TIME_ZONE: "America/Santiago", NODE_ENV: "test" };

test("usa disabled como modo inicial explícito", () => {
  const config = getTransactionalEmailConfig(base);
  assert.equal(config.mode, "disabled");
  assert.equal(config.apiKey, null);
});

test("simulate no exige proveedor fuera de producción", () => {
  assert.equal(getTransactionalEmailConfig({ ...base, EMAIL_MODE: "simulate" }).mode, "simulate");
});

test("prohíbe simulación silenciosa en producción", () => {
  assert.throws(
    () => getTransactionalEmailConfig({ ...base, EMAIL_MODE: "simulate", NODE_ENV: "production" }),
    (error) => error instanceof EmailConfigurationError
      && error.code === "SIMULATION_FORBIDDEN_IN_PRODUCTION",
  );
});

test("test exige destinatario seguro, clave y remitente", () => {
  assert.throws(
    () => getTransactionalEmailConfig({ ...base, EMAIL_MODE: "test" }),
    (error) => error.code === "INCOMPLETE_EMAIL_CONFIGURATION",
  );
  const config = getTransactionalEmailConfig({
    ...base,
    EMAIL_FROM: "Stylo Vivo <onboarding@resend.dev>",
    EMAIL_MODE: "test",
    EMAIL_TEST_RECIPIENT: " PRUEBAS@EXAMPLE.COM ",
    RESEND_API_KEY: "clave-de-prueba-no-real",
  });
  assert.equal(config.testRecipient, "pruebas@example.com");
});

test("live falla cerrado sin dominio verificado", () => {
  assert.throws(
    () => getTransactionalEmailConfig({
      ...base,
      EMAIL_FROM: "Stylo Vivo <correo@example.com>",
      EMAIL_MODE: "live",
      RESEND_API_KEY: "clave-de-prueba-no-real",
    }),
    (error) => error.code === "EMAIL_DOMAIN_NOT_VERIFIED",
  );
});

test("live configurado conserva secretos fuera del diagnóstico", () => {
  const environment = {
    ...base,
    CRON_SECRET: "secreto-cron-de-prueba",
    EMAIL_DOMAIN_VERIFIED: "true",
    EMAIL_FROM: "Stylo Vivo <correo@example.com>",
    EMAIL_MODE: "live",
    RESEND_API_KEY: "clave-de-prueba-no-real",
    RESEND_WEBHOOK_SECRET: "whsec_prueba",
  };
  assert.equal(getTransactionalEmailConfig(environment).mode, "live");
  const diagnostic = getTransactionalEmailDiagnostic(environment);
  assert.deepEqual(diagnostic, {
    domainVerified: true,
    mode: "live",
    provider: "RESEND",
    ready: true,
    testRecipientConfigured: false,
    webhookConfigured: true,
    workerConfigured: true,
  });
  assert.equal(JSON.stringify(diagnostic).includes("clave-de-prueba"), false);
});

test("rechaza modos y zonas horarias desconocidos", () => {
  assert.throws(
    () => getTransactionalEmailConfig({ ...base, EMAIL_MODE: "automatic" }),
    (error) => error.code === "INVALID_EMAIL_MODE",
  );
  assert.throws(
    () => getTransactionalEmailConfig({ ...base, APP_TIME_ZONE: "UTC" }),
    (error) => error.code === "INVALID_EMAIL_TIME_ZONE",
  );
});

